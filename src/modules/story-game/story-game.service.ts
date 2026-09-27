import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from '@/db/entities';
import { UniqueNamesAdapter } from '@/common/src/unique-names/unique-names.adapter';
import { StoryChanges, StoryStateRepository } from './story-state.repository';
import { StoryError } from './domain/story-game.errors';
import {
  CharacterSheet,
  STORY_ENDED_STATUSES,
  StoryConfig,
  StoryGame,
  StorySnapshot,
  StoryStatus,
} from './domain/story-game.types';
import { STORY_DEFAULT_CONFIG, STORY_MAX_PLAYERS, STORY_MIN_PLAYERS } from './story-game.config';

const MAX_GAME_ID_ATTEMPTS = 5;

/**
 * Máquina de estados y reglas del modo Historieta. Todo cambio de estado pasa
 * por `mutate`: lock de la partida → leer → validar/modificar → escritura
 * atómica con fencing. El gateway solo traduce eventos y difunde el resultado.
 */
@Injectable()
export class StoryGameService {
  private readonly logger = new Logger(StoryGameService.name);

  constructor(
    private readonly store: StoryStateRepository,
    @InjectRepository(User)
    private readonly users: Repository<User>,
    private readonly uniqueNames: UniqueNamesAdapter,
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
      const existing = game.players.find((player) => player.userId === userId);
      if (existing && !existing.left) {
        existing.connected = true;
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

  async startCharacters(gameId: string, userId: string): Promise<StorySnapshot> {
    return this.mutate(gameId, ({ game }) => {
      this.assertHost(game, userId);
      if (game.status !== StoryStatus.LOBBY) {
        throw StoryError.invalidState('start the characters step', game.status);
      }
      this.assertEnoughPlayers(game);

      game.status = StoryStatus.CHARACTERS;
      return { game };
    });
  }

  /** Crea (o reemplaza, mientras dure el paso de personajes) la ficha del jugador. */
  async createCharacter(
    gameId: string,
    userId: string,
    sheet: CharacterSheet,
  ): Promise<StorySnapshot> {
    return this.mutate(gameId, ({ game }) => {
      if (game.status !== StoryStatus.CHARACTERS) {
        throw StoryError.invalidState('create a character', game.status);
      }
      this.assertActivePlayer(game, userId);

      const { name, type, trait, clothing, detail } = sheet;
      return { setCharacters: { [userId]: { name, type, trait, clothing, detail } } };
    });
  }

  /** CHARACTERS → PLAYING. Solo el anfitrión, y todos los jugadores con personaje. */
  async startStory(gameId: string, userId: string): Promise<StorySnapshot> {
    return this.mutate(gameId, ({ game, characters }) => {
      this.assertHost(game, userId);
      if (game.status !== StoryStatus.CHARACTERS) {
        throw StoryError.invalidState('start the story', game.status);
      }
      this.assertEnoughPlayers(game);

      const missing = game.players.filter((player) => !player.left && !characters[player.userId]);
      if (missing.length > 0) {
        throw new StoryError(
          'CHARACTERS_MISSING',
          `Waiting for characters from: ${missing.map((player) => player.username).join(', ')}`,
          HttpStatus.CONFLICT,
        );
      }

      game.status = StoryStatus.PLAYING;
      game.currentPanel = 0;
      return { game };
    });
  }

  /**
   * Salir de la partida. En LOBBY/CHARACTERS el jugador se quita de la lista;
   * después se marca `left` y se queda, porque el orden define los turnos.
   */
  async leaveGame(gameId: string, userId: string): Promise<StorySnapshot> {
    const snapshot = await this.mutate(gameId, ({ game }) => {
      if (STORY_ENDED_STATUSES.includes(game.status)) return null;
      const player = this.assertActivePlayer(game, userId);

      this.handOverHost(game, userId);
      const changes: StoryChanges = { game };
      if (game.status === StoryStatus.LOBBY || game.status === StoryStatus.CHARACTERS) {
        game.players = game.players.filter((other) => other.userId !== userId);
        changes.deleteCharacters = [userId];
      } else {
        player.left = true;
        player.connected = false;
      }
      this.abandonIfEmpty(game);
      return changes;
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
      this.abandonIfEmpty(game);
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

  async getSnapshot(gameId: string): Promise<StorySnapshot> {
    const snapshot = await this.store.get(gameId);
    if (!snapshot) throw StoryError.gameNotFound(gameId);
    return snapshot;
  }

  /**
   * Lock → leer → `fn` valida y modifica la copia leída → escritura atómica.
   * `fn` devuelve los cambios a guardar, o null si no hay nada que guardar.
   */
  private mutate(
    gameId: string,
    fn: (snapshot: StorySnapshot) => StoryChanges | null,
  ): Promise<StorySnapshot> {
    return this.store.withGameLock(gameId, async (lock) => {
      const snapshot = await this.getSnapshot(gameId);
      const changes = fn(snapshot);
      if (!changes) return snapshot;

      await this.store.save(gameId, lock, changes);

      const characters = { ...snapshot.characters, ...changes.setCharacters };
      for (const userId of changes.deleteCharacters ?? []) delete characters[userId];
      return { game: changes.game ?? snapshot.game, characters };
    });
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

  private assertEnoughPlayers(game: StoryGame) {
    const active = game.players.filter((player) => !player.left).length;
    if (active < STORY_MIN_PLAYERS) {
      throw new StoryError(
        'NOT_ENOUGH_PLAYERS',
        `At least ${STORY_MIN_PLAYERS} players are needed`,
        HttpStatus.CONFLICT,
      );
    }
  }

  /** Si `userId` es el anfitrión, pasa al siguiente jugador conectado en orden de entrada. */
  private handOverHost(game: StoryGame, userId: string) {
    if (game.hostId !== userId) return;

    const count = game.players.length;
    const from = game.players.findIndex((player) => player.userId === userId);
    for (let step = 1; step < count; step++) {
      const candidate = game.players[(from + step) % count];
      if (candidate.connected && !candidate.left) {
        game.hostId = candidate.userId;
        this.logger.debug(`story ${game.gameId}: host ${userId} → ${candidate.userId}`);
        return;
      }
    }
    // Nadie más conectado: la partida queda abandonada (abandonIfEmpty).
  }

  private abandonIfEmpty(game: StoryGame) {
    if (!game.players.some((player) => player.connected && !player.left)) {
      game.status = StoryStatus.ABANDONED;
      this.logger.log(`story ${game.gameId} abandoned`);
    }
  }
}
