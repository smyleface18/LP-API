import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from '@/db/entities';
import { UniqueNamesAdapter } from '@/common/src/unique-names/unique-names.adapter';
import { StoryChanges, StoryStateRepository } from './story-state.repository';
import { StoryError } from './domain/story-game.errors';
import {
  STORY_ABANDONABLE_STATUSES,
  STORY_ENDED_STATUSES,
  StoryConfig,
  StoryGame,
  StorySnapshot,
  StoryStatus,
} from './domain/story-game.types';
import {
  IDLE_ABANDON_DELAY_MS,
  STORY_DEFAULT_CONFIG,
  STORY_MAX_PLAYERS,
  STORY_MIN_PLAYERS,
} from './story-game.config';
import { STORY_CANCEL_EVENT, STORY_SCHEDULE_EVENT, StoryJob } from './queue/type';

const MAX_GAME_ID_ATTEMPTS = 5;

/**
 * Máquina de estados y reglas del modo Historieta. Todo cambio de estado pasa
 * por `mutate`: lock de la partida → leer → validar/modificar → escritura
 * atómica con fencing → programar/cancelar tareas diferidas. El gateway solo
 * traduce eventos y difunde el resultado.
 */
@Injectable()
export class StoryGameService {
  private readonly logger = new Logger(StoryGameService.name);

  constructor(
    private readonly store: StoryStateRepository,
    @InjectRepository(User)
    private readonly users: Repository<User>,
    private readonly uniqueNames: UniqueNamesAdapter,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  async createGame(userId: string): Promise<StorySnapshot> {
    const user = await this.findUser(userId);
    await this.assertNotInAnotherGame(userId, null);

    for (let attempt = 0; attempt < MAX_GAME_ID_ATTEMPTS; attempt++) {
      const now = Date.now();
      const game: StoryGame = {
        gameId: this.uniqueNames.NamesGenerator(),
        status: StoryStatus.LOBBY,
        hostId: user.id,
        config: { ...STORY_DEFAULT_CONFIG },
        players: [
          { userId: user.id, username: user.username, connected: true, left: false, joinedAt: now },
        ],
        currentPanel: null,
        turnEndsAt: null,
        abandonAt: null,
        abandonSeq: 0,
        createdAt: now,
      };

      // create() no pisa una partida existente con el mismo id.
      if (await this.store.create(game)) {
        await this.store.setUserGame(user.id, game.gameId);
        return { game, characters: {} };
      }
    }

    throw new StoryError(
      'INVALID_STATE',
      'Could not allocate a game, try again',
      HttpStatus.SERVICE_UNAVAILABLE,
    );
  }

  /** Unirse al lobby. Si el usuario ya era jugador, es una reconexión y no cambia el orden. */
  async joinGame(gameId: string, userId: string): Promise<StorySnapshot> {
    const user = await this.findUser(userId);
    await this.assertNotInAnotherGame(userId, gameId);

    const snapshot = await this.mutate(gameId, ({ game }) => {
      if (STORY_ENDED_STATUSES.includes(game.status)) {
        throw StoryError.invalidState('join', game.status);
      }

      const existing = game.players.find((player) => player.userId === userId);
      if (existing && !existing.left) {
        existing.connected = true;
        this.onPlayerConnected(game);
        return { game };
      }

      if (game.status !== StoryStatus.LOBBY) throw StoryError.invalidState('join', game.status);
      if (game.players.length >= STORY_MAX_PLAYERS) {
        throw new StoryError('GAME_FULL', 'The game is full', HttpStatus.CONFLICT);
      }

      game.players.push({
        userId: user.id,
        username: user.username,
        connected: true,
        left: false,
        joinedAt: Date.now(),
      });
      this.onPlayerConnected(game);
      return { game };
    });

    await this.store.setUserGame(userId, gameId);
    return snapshot;
  }

  async updateConfig(
    gameId: string,
    userId: string,
    patch: Partial<StoryConfig>,
  ): Promise<StorySnapshot> {
    return this.mutate(gameId, ({ game }) => {
      this.assertHost(game, userId);
      if (game.status !== StoryStatus.LOBBY) {
        throw StoryError.invalidState('change the settings', game.status);
      }

      const defined = Object.fromEntries(
        Object.entries(patch).filter(([, value]) => value !== undefined),
      ) as Partial<StoryConfig>;
      game.config = { ...game.config, ...defined };
      return { game };
    });
  }

  /** El anfitrión saca a un jugador del lobby. El gateway le avisa con `KICKED`. */
  async kickPlayer(gameId: string, hostId: string, targetId: string): Promise<StorySnapshot> {
    const snapshot = await this.mutate(gameId, ({ game }) => {
      this.assertHost(game, hostId);
      if (game.status !== StoryStatus.LOBBY) {
        throw StoryError.invalidState('kick a player', game.status);
      }
      if (targetId === hostId) {
        throw new StoryError('CANNOT_KICK_SELF', 'The host cannot kick themselves');
      }
      this.assertActivePlayer(game, targetId);

      game.players = game.players.filter((player) => player.userId !== targetId);
      return { game };
    });

    await this.store.clearUserGame(targetId, gameId);
    return snapshot;
  }

  /** LOBBY → PLAYING (solo anfitrión). La apertura del primer turno llega en la Fase 2. */
  async startStory(gameId: string, userId: string): Promise<StorySnapshot> {
    return this.mutate(gameId, ({ game }) => {
      this.assertHost(game, userId);
      if (game.status !== StoryStatus.LOBBY) {
        throw StoryError.invalidState('start the story', game.status);
      }

      const connected = game.players.filter((player) => player.connected && !player.left);
      if (connected.length < STORY_MIN_PLAYERS) {
        throw new StoryError(
          'NOT_ENOUGH_PLAYERS',
          `At least ${STORY_MIN_PLAYERS} connected players are needed`,
          HttpStatus.CONFLICT,
        );
      }
      // Todos escriben al menos una viñeta.
      if (game.config.panelsCount < game.players.length) {
        throw new StoryError(
          'NOT_ENOUGH_PANELS',
          `The story needs at least one panel per player (${game.players.length})`,
          HttpStatus.CONFLICT,
        );
      }

      game.status = StoryStatus.PLAYING;
      game.currentPanel = 0;
      return { game };
    });
  }

  /**
   * Salir de la partida. En LOBBY el jugador se quita de la lista; después se
   * marca `left` y se queda, porque el orden define los turnos.
   */
  async leaveGame(gameId: string, userId: string): Promise<StorySnapshot> {
    const snapshot = await this.mutate(gameId, ({ game }) => {
      if (STORY_ENDED_STATUSES.includes(game.status)) return null;
      const player = this.assertActivePlayer(game, userId);

      this.handOverHost(game, userId);
      if (game.status === StoryStatus.LOBBY) {
        game.players = game.players.filter((other) => other.userId !== userId);
      } else {
        player.left = true;
        player.connected = false;
      }
      this.onPlayerGone(game);
      return { game };
    });

    await this.store.clearUserGame(userId, gameId);
    return snapshot;
  }

  /**
   * El socket se cortó: el jugador queda desconectado (no "se fue") y puede
   * volver con `resume`. Si era anfitrión, pasa al siguiente conectado.
   */
  async disconnect(gameId: string, userId: string): Promise<StorySnapshot | null> {
    let changed = false;
    const snapshot = await this.mutate(gameId, ({ game }) => {
      if (STORY_ENDED_STATUSES.includes(game.status)) return null;
      const player = game.players.find((other) => other.userId === userId);
      if (!player || player.left || !player.connected) return null;

      player.connected = false;
      this.handOverHost(game, userId);
      this.onPlayerGone(game);
      changed = true;
      return { game };
    });
    return changed ? snapshot : null;
  }

  /** Reconexión: vuelve a marcar al jugador como conectado en su partida activa, si tiene. */
  async resume(userId: string): Promise<StorySnapshot | null> {
    const gameId = await this.store.getUserGame(userId);
    if (!gameId) return null;

    let active = false;
    try {
      const snapshot = await this.mutate(gameId, ({ game }) => {
        if (STORY_ENDED_STATUSES.includes(game.status)) return null;
        const player = game.players.find((other) => other.userId === userId);
        if (!player || player.left) return null;

        active = true;
        if (player.connected) return null;
        player.connected = true;
        this.onPlayerConnected(game);
        return { game };
      });
      if (active) return snapshot;
    } catch (error) {
      // La partida expiró (TTL): se limpia la referencia.
      if (!(error instanceof StoryError && error.code === 'GAME_NOT_FOUND')) throw error;
    }

    await this.store.clearUserGame(userId, gameId);
    return null;
  }

  /**
   * Tarea diferida `abandon-idle`: la partida siguió sin nadie conectado durante
   * IDLE_ABANDON_DELAY_MS. Si alguien volvió, si la partida se vació otra vez
   * después (otro `abandonSeq`) o si ya no está en LOBBY/PLAYING, la tarea
   * está obsoleta y no hace nada.
   */
  async abandonIdleGame(gameId: string, seq: number): Promise<void> {
    try {
      await this.mutate(gameId, ({ game }) => {
        if (!STORY_ABANDONABLE_STATUSES.includes(game.status)) return null;
        if (game.abandonAt === null || game.abandonSeq !== seq) return null;
        if (game.players.some((player) => player.connected && !player.left)) return null;

        game.status = StoryStatus.ABANDONED;
        game.abandonAt = null;
        this.logger.log(`story ${gameId} abandoned (nobody came back)`);
        return { game };
      });
    } catch (error) {
      // Expiró por TTL: no queda nada que abandonar.
      if (!(error instanceof StoryError && error.code === 'GAME_NOT_FOUND')) throw error;
    }
  }

  /**
   * Partida activa del usuario. Sale de Redis y no del socket: así vale en
   * todas las instancias y no queda desactualizada si lo expulsan desde otra.
   */
  getActiveGameId(userId: string): Promise<string | null> {
    return this.store.getUserGame(userId);
  }

  async getSnapshot(gameId: string): Promise<StorySnapshot> {
    const snapshot = await this.store.get(gameId);
    if (!snapshot) throw StoryError.gameNotFound(gameId);
    return snapshot;
  }

  /**
   * Lock → leer → `fn` valida y modifica la copia leída → escritura atómica →
   * sincronizar tareas diferidas. `fn` devuelve los cambios a guardar, o null
   * si no hay nada que guardar.
   */
  private async mutate(
    gameId: string,
    fn: (snapshot: StorySnapshot) => StoryChanges | null,
  ): Promise<StorySnapshot> {
    const { previous, next } = await this.store.withGameLock(gameId, async (lock) => {
      const snapshot = await this.getSnapshot(gameId);
      const previous = structuredClone(snapshot.game);
      const changes = fn(snapshot);
      if (!changes) return { previous, next: snapshot };

      await this.store.save(gameId, lock, changes);
      const next: StorySnapshot = {
        game: changes.game ?? snapshot.game,
        characters: { ...snapshot.characters, ...changes.addCharacters },
      };
      return { previous, next };
    });

    await this.syncAbandonTimer(previous, next.game);
    return next;
  }

  /** Programa la tarea de abandono si la partida quedó vacía y borra la anterior si ya no vale. */
  private async syncAbandonTimer(previous: StoryGame, next: StoryGame) {
    const job = (game: StoryGame): StoryJob | null =>
      game.abandonAt === null
        ? null
        : {
            gameId: game.gameId,
            kind: 'abandon-idle',
            seq: game.abandonSeq,
            dueAt: game.abandonAt,
          };
    const before = job(previous);
    const after = job(next);
    if (before?.seq === after?.seq && before?.dueAt === after?.dueAt) return;

    if (before) this.eventEmitter.emit(STORY_CANCEL_EVENT, before);
    // emitAsync espera al listener: si no se puede programar, el error sube.
    if (after) await this.eventEmitter.emitAsync(STORY_SCHEDULE_EVENT, after);
  }

  /** Alguien (re)conectó: la partida deja de estar vacía y el anfitrión tiene que estar conectado. */
  private onPlayerConnected(game: StoryGame) {
    game.abandonAt = null;

    const host = game.players.find((player) => player.userId === game.hostId);
    if (!host || !host.connected || host.left) this.handOverHost(game, game.hostId);
  }

  /**
   * Se fue o se desconectó alguien. En LOBBY/PLAYING sin nadie conectado se
   * espera IDLE_ABANDON_DELAY_MS por si vuelven (ej. un redeploy corta todos
   * los sockets); si ya nadie puede volver (todos salieron), se abandona en el
   * acto. PROCESSING y REVIEW nunca se abandonan.
   */
  private onPlayerGone(game: StoryGame) {
    if (!STORY_ABANDONABLE_STATUSES.includes(game.status)) return;
    if (game.players.some((player) => player.connected && !player.left)) return;

    if (!game.players.some((player) => !player.left)) {
      game.status = StoryStatus.ABANDONED;
      game.abandonAt = null;
      this.logger.log(`story ${game.gameId} abandoned (everyone left)`);
      return;
    }

    if (game.abandonAt === null) {
      game.abandonSeq += 1;
      game.abandonAt = Date.now() + IDLE_ABANDON_DELAY_MS;
    }
  }

  private async findUser(userId: string): Promise<User> {
    const user = await this.users.findOne({ where: { id: userId } });
    if (!user) throw new StoryError('USER_NOT_FOUND', 'User not found', HttpStatus.NOT_FOUND);
    return user;
  }

  /** Un usuario no puede estar en dos partidas activas a la vez. */
  private async assertNotInAnotherGame(userId: string, gameId: string | null): Promise<void> {
    const current = await this.store.getUserGame(userId);
    if (!current || current === gameId) return;

    const snapshot = await this.store.get(current);
    const player = snapshot?.game.players.find((other) => other.userId === userId);
    if (
      snapshot &&
      !STORY_ENDED_STATUSES.includes(snapshot.game.status) &&
      player &&
      !player.left
    ) {
      throw new StoryError(
        'ALREADY_IN_GAME',
        `You are already in story game ${current}; leave it first`,
        HttpStatus.CONFLICT,
      );
    }
  }

  private assertHost(game: StoryGame, userId: string) {
    if (game.hostId !== userId) throw StoryError.notHost();
  }

  private assertActivePlayer(game: StoryGame, userId: string) {
    const player = game.players.find((other) => other.userId === userId);
    if (!player || player.left) throw StoryError.notAPlayer();
    return player;
  }

  /**
   * Pasa el anfitrión de `fromUserId` al siguiente jugador conectado en orden de
   * entrada (circular). Si no hay nadie conectado, no cambia.
   */
  private handOverHost(game: StoryGame, fromUserId: string) {
    if (game.hostId !== fromUserId) return;

    const count = game.players.length;
    const from = game.players.findIndex((player) => player.userId === fromUserId);
    for (let step = 1; step <= count; step++) {
      const candidate = game.players[(from + step) % count];
      if (candidate.userId !== fromUserId && candidate.connected && !candidate.left) {
        game.hostId = candidate.userId;
        this.logger.debug(`story ${game.gameId}: host ${fromUserId} → ${candidate.userId}`);
        return;
      }
    }
  }
}
