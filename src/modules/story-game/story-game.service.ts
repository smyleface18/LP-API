import { randomUUID } from 'crypto';
import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { EventEmitter2, OnEvent } from '@nestjs/event-emitter';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from '@/db/entities';
import { UniqueNamesAdapter } from '@/common/src/unique-names/unique-names.adapter';
import { LanguageReviewer } from '@/modules/language-review/language-reviewer';
import { StoryTitler } from '@/modules/language-review/story-titler';
import {
  LanguageReview,
  LanguageReviewInput,
} from '@/modules/language-review/language-review.types';
import { PanelGuardError, StoryChanges, StoryStateRepository } from './story-state.repository';
import { StoryError } from './domain/story-game.errors';
import { StoryUrlSigner } from './story-url-signer.service';
import {
  PanelMediaRequestEvent,
  ProcessingStartedEvent,
  STORY_EVENTS,
  StoryOutboxItem,
} from './domain/story-game.events';
import { ReviewManifest, toReviewManifest } from './domain/story-review';
import {
  DraftInput,
  PanelConfirmedBy,
  PanelAudioResult,
  PanelImageResult,
  PanelState,
  STORY_ABANDONABLE_STATUSES,
  STORY_ENDED_STATUSES,
  STORY_REACTABLE_STATUSES,
  StoryConfig,
  StoryGame,
  StorySnapshot,
  StoryStatus,
} from './domain/story-game.types';
import {
  authorFor,
  authorStatusOf,
  castOf,
  closedPanels,
  confirmPanel,
  nextAuthorAfter,
  openTurn,
  remainingPlayers,
  storySoFar,
  validateDraft,
} from './domain/story-turns';
import { GameStateView, PanelReviewResultView, toGameStateView } from './domain/story-game.views';
import { REVIEW_TIMEOUT_MS } from '@/modules/language-review/language-review.config';
import {
  FINISHED_STORY_TTL_MS,
  IDLE_ABANDON_DELAY_MS,
  MEDIA_DEADLINE_MS,
  REVIEW_MAX_WAIT_MS,
  MAX_DRAFTS_PER_TURN,
  MAX_REVIEW_ATTEMPTS,
  REVIEW_CLOSE_GRACE_MS,
  REVIEW_STALE_MS,
  STORY_DEFAULT_CONFIG,
  STORY_MAX_PLAYERS,
  STORY_MIN_PLAYERS,
  STORY_MIN_PLAYERS_TO_CONTINUE,
  StoryReaction,
} from './story-game.config';
import { STORY_CANCEL_EVENT, STORY_SCHEDULE_EVENT, StoryJob, storyJobId } from './queue/type';

const MAX_GAME_ID_ATTEMPTS = 5;

type Mutation = (snapshot: StorySnapshot, outbox: StoryOutboxItem[]) => StoryChanges | null;

/**
 * Máquina de estados y reglas del modo Historieta. Todo cambio de estado pasa
 * por `mutate`: lock de la partida → leer → validar/modificar → escritura
 * atómica con fencing → programar/cancelar tareas diferidas → publicar
 * eventos. El gateway traduce eventos y difunde el resultado.
 */
/** A la viñeta le falta el audio o la imagen. */
const hasPendingMedia = (panel: PanelState) =>
  panel.media?.status === 'pending' || panel.media?.imageStatus === 'pending';

/** Falta algo de la historieta terminada: audio o imagen de alguna viñeta, o el título. */
const hasPendingWork = (snapshot: StorySnapshot) =>
  snapshot.game.titlePending || closedPanels(snapshot).some(hasPendingMedia);

@Injectable()
export class StoryGameService {
  private readonly logger = new Logger(StoryGameService.name);

  constructor(
    private readonly store: StoryStateRepository,
    @InjectRepository(User)
    private readonly users: Repository<User>,
    private readonly uniqueNames: UniqueNamesAdapter,
    private readonly eventEmitter: EventEmitter2,
    private readonly reviewer: LanguageReviewer,
    private readonly urls: StoryUrlSigner,
    private readonly titler: StoryTitler,
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
          {
            userId: user.id,
            username: user.username,
            avatarKey: user.avatar?.key ?? null,
            connected: true,
            left: false,
            joinedAt: now,
            totalScore: 0,
            panelsWritten: 0,
          },
        ],
        currentPanel: null,
        turnEndsAt: null,
        turnCloseAt: null,
        abandonAt: null,
        abandonSeq: 0,
        createdAt: now,
        storyId: null,
        mediaDeadlineAt: null,
        reviewAt: null,
        title: null,
        titlePending: false,
      };

      // create() no pisa una partida existente con el mismo id.
      if (await this.store.create(game)) {
        await this.store.setUserGame(user.id, game.gameId);
        return { game, characters: {}, panels: {} };
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
        existing.avatarKey = user.avatar?.key ?? null;
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
        avatarKey: user.avatar?.key ?? null,
        connected: true,
        left: false,
        joinedAt: Date.now(),
        totalScore: 0,
        panelsWritten: 0,
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

  /** LOBBY → PLAYING (solo anfitrión) y abre el turno de la primera viñeta. */
  async startStory(gameId: string, userId: string): Promise<StorySnapshot> {
    return this.mutate(gameId, (snapshot, outbox) => {
      const { game } = snapshot;
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
      outbox.push({ event: STORY_EVENTS.stateChanged, payload: { snapshot } });
      const panel = this.startTurn(snapshot, 0, authorFor(game, 0), Date.now(), outbox);
      return { game, setPanels: [panel] };
    });
  }

  /**
   * Borrador del autor del turno. Tres pasos, para no tener el lock tomado
   * mientras se espera a la IA:
   *   a) con lock: valida y marca la viñeta como "en revisión" (attemptId);
   *   b) sin lock: revisa el inglés;
   *   c) con lock: guarda el resultado solo si la viñeta sigue abierta y la
   *      revisión en curso sigue siendo esta (Redis lo verifica en el script).
   * Solo una revisión exitosa y no flagged consume intento.
   */
  async submitPanelDraft(
    gameId: string,
    userId: string,
    panelOrder: number,
    draft: DraftInput,
  ): Promise<PanelReviewResultView> {
    const attemptId = randomUUID();
    let reviewInput: LanguageReviewInput | undefined;

    await this.mutate(gameId, (snapshot, outbox) => {
      const panel = this.assertAuthorTurn(snapshot, userId, panelOrder);
      const now = Date.now();
      if (snapshot.game.turnEndsAt !== null && now > snapshot.game.turnEndsAt) {
        throw new StoryError(
          'TURN_EXPIRED',
          'The time for this panel is over',
          HttpStatus.CONFLICT,
        );
      }
      this.assertNotReviewing(panel, now);
      if (panel.submissions >= MAX_DRAFTS_PER_TURN) {
        throw new StoryError(
          'DRAFT_LIMIT_REACHED',
          `You already sent ${MAX_DRAFTS_PER_TURN} drafts for this panel; confirm it`,
          HttpStatus.CONFLICT,
        );
      }
      if (panel.attempts >= MAX_REVIEW_ATTEMPTS) {
        throw new StoryError(
          'NO_ATTEMPTS_LEFT',
          `You already used your ${MAX_REVIEW_ATTEMPTS} reviews; confirm your panel`,
          HttpStatus.CONFLICT,
        );
      }
      validateDraft(snapshot, draft);

      panel.submissions += 1;
      panel.reviewing = { attemptId, startedAt: now };
      reviewInput = {
        text: draft.text,
        scene: draft.scene,
        level: snapshot.game.config.level,
        storySoFar: storySoFar(snapshot).map((summary) => summary.finalText),
        cast: castOf(snapshot).map(({ name, kind, description }) => ({ name, kind, description })),
        newCharacters: draft.newCharacters,
      };
      this.pushAuthorStatus(snapshot, panel, now, outbox);
      return { setPanels: [panel], guard: { order: panelOrder } };
    });

    const review = await this.reviewSafely(reviewInput!);

    let result: PanelReviewResultView | undefined;
    await this.mutate(gameId, (snapshot, outbox) => {
      const panel = snapshot.panels[panelOrder];
      if (
        snapshot.game.status !== StoryStatus.PLAYING ||
        panel?.status !== 'open' ||
        panel.reviewing?.attemptId !== attemptId
      ) {
        // El turno se cerró (timeout, reasignación, fin anticipado) mientras se revisaba.
        throw StoryError.turnClosed(panelOrder);
      }

      panel.reviewing = null;
      if (review?.flagged) {
        result = this.reviewResult(panel, review, {
          message: 'This text is not appropriate for the story. Please rewrite it.',
        });
      } else {
        panel.drafts.push({ ...draft, review });
        if (review) panel.attempts += 1;
        result = this.reviewResult(panel, review);
        if (snapshot.game.config.shareDrafts) {
          outbox.push({
            event: STORY_EVENTS.draftReviewed,
            payload: {
              gameId,
              order: panelOrder,
              authorId: userId,
              ...draft,
              reviewAvailable: result.reviewAvailable,
              corrections: result.corrections,
              characterCorrections: result.characterCorrections,
            },
          });
        }
      }

      const guard = { order: panelOrder, attemptId };
      const now = Date.now();
      if (panel.closeWhenReviewed) {
        // El turno venció mientras se revisaba: se cierra con este borrador.
        return { ...this.closeTurn(snapshot, panel, 'timeout', outbox, now), guard };
      }
      this.pushAuthorStatus(snapshot, panel, now, outbox);
      return { setPanels: [panel], guard };
    });

    return result!;
  }

  /** El autor confirma su último borrador: cierra la viñeta y abre el siguiente turno. */
  async confirmPanel(gameId: string, userId: string, panelOrder: number): Promise<void> {
    await this.mutate(gameId, (snapshot, outbox) => {
      const panel = this.assertAuthorTurn(snapshot, userId, panelOrder);
      const now = Date.now();
      this.assertNotReviewing(panel, now);
      if (panel.drafts.length === 0) {
        throw new StoryError('NO_DRAFT', 'Send a draft before confirming', HttpStatus.CONFLICT);
      }
      return this.closeTurn(snapshot, panel, 'player', outbox, now);
    });
  }

  /**
   * Tarea diferida `close-turn`: venció el turno de la viñeta `seq`. Si ya se
   * cerró (confirmación), se reasignó o se reprogramó (otro dueAt) o la
   * partida cambió, la tarea está obsoleta y no hace nada.
   *
   * Si hay una revisión en curso, no se cierra todavía: se marca
   * `closeWhenReviewed` (el resultado cierra el turno con ese borrador) y la
   * tarea se reprograma como respaldo. Cuando corre el respaldo, se cierra con
   * lo que haya.
   */
  async closeTurnByTimeout(gameId: string, seq: number, dueAt: number): Promise<void> {
    try {
      await this.mutate(gameId, (snapshot, outbox) => {
        const { game } = snapshot;
        const panel = snapshot.panels[seq];
        if (
          game.status !== StoryStatus.PLAYING ||
          game.currentPanel !== seq ||
          game.turnCloseAt !== dueAt ||
          panel?.status !== 'open'
        ) {
          return null;
        }

        const now = Date.now();
        if (panel.reviewing && !panel.closeWhenReviewed) {
          const backupAt = panel.reviewing.startedAt + REVIEW_TIMEOUT_MS + REVIEW_CLOSE_GRACE_MS;
          if (backupAt > now) {
            panel.closeWhenReviewed = true;
            game.turnCloseAt = backupAt;
            return { game, setPanels: [panel], guard: { order: seq } };
          }
        }
        return this.closeTurn(snapshot, panel, 'timeout', outbox, now);
      });
    } catch (error) {
      if (error instanceof StoryError && ['GAME_NOT_FOUND', 'TURN_CLOSED'].includes(error.code)) {
        return;
      }
      throw error;
    }
  }

  /**
   * Reacción de un jugador a una viñeta confirmada: una por jugador y viñeta.
   * Otra reacción la reemplaza y `null` la quita. Vale desde que la viñeta se
   * confirma hasta que la partida termina (también en el review final).
   */
  async reactToPanel(
    gameId: string,
    userId: string,
    panelOrder: number,
    emoji: StoryReaction | null,
  ): Promise<void> {
    await this.mutate(gameId, (snapshot, outbox) => {
      const { game } = snapshot;
      if (!STORY_REACTABLE_STATUSES.includes(game.status)) {
        throw StoryError.invalidState('react to a panel', game.status);
      }
      this.assertActivePlayer(game, userId);
      const panel = snapshot.panels[panelOrder];
      if (panel?.status !== 'closed') {
        throw new StoryError(
          'PANEL_NOT_CONFIRMED',
          `Panel ${panelOrder} is not confirmed yet`,
          HttpStatus.CONFLICT,
        );
      }

      panel.reactions ??= {};
      if ((panel.reactions[userId] ?? null) === emoji) return null;
      if (emoji === null) delete panel.reactions[userId];
      else panel.reactions[userId] = emoji;

      outbox.push({
        event: STORY_EVENTS.panelReaction,
        payload: { gameId, order: panelOrder, userId, emoji },
      });
      return { setPanels: [panel] };
    });
  }

  /**
   * Punto único de la generación de la historieta: corre al entrar a PROCESSING.
   * Pide la media de cada viñeta (cola `story-media`) y el título (en paralelo).
   * REVIEW llega cuando está todo, o al vencer REVIEW_MAX_WAIT_MS si la primera
   * viñeta ya tiene audio; FINISHED cuando no falta nada (o vence
   * MEDIA_DEADLINE_MS). Sin nada que generar, pasa de largo a FINISHED.
   */
  @OnEvent(STORY_EVENTS.processingStarted, { async: true, promisify: true })
  async onProcessingStarted({ gameId }: ProcessingStartedEvent): Promise<void> {
    try {
      await this.requestMedia(gameId);
      await Promise.all([this.generateTitle(gameId), this.advanceAfterMedia(gameId)]);
    } catch (error) {
      this.logger.error(`story ${gameId}: processing failed: ${(error as Error).message}`);
    }
  }

  /**
   * Asigna el `storyId`, marca cada viñeta confirmada como `pending` (o `none`
   * si venció sin texto) y emite `mediaRequested`. Idempotente: solo corre una
   * vez por partida (la segunda ve el `storyId`).
   */
  async requestMedia(gameId: string): Promise<void> {
    await this.mutate(gameId, (snapshot, outbox) => {
      const { game } = snapshot;
      if (game.status !== StoryStatus.PROCESSING || game.storyId !== null) return null;

      const storyId = randomUUID();
      game.storyId = storyId;
      const panels = closedPanels(snapshot);
      const requests: PanelMediaRequestEvent[] = [];
      for (const panel of panels) {
        const hasText = !!panel.originalText;
        panel.media = {
          status: hasText ? 'pending' : 'none',
          audioKey: null,
          imageKey: null,
          imageStatus: hasText ? 'pending' : 'none',
          speechMarks: null,
        };
        if (!hasText) continue;
        requests.push({
          gameId,
          storyId,
          order: panel.order,
          text: panel.finalText ?? '',
          scene: panel.scene ?? '',
          characters: panel.characterIds
            .map((id) => snapshot.characters[id])
            .filter((character) => !!character)
            .map(({ name, kind, description }) => ({ name, kind, description })),
          languageCode: game.config.language,
        });
      }

      if (requests.length > 0) {
        const now = Date.now();
        game.mediaDeadlineAt = now + MEDIA_DEADLINE_MS;
        game.reviewAt = now + REVIEW_MAX_WAIT_MS;
        game.titlePending = true;
        outbox.push({ event: STORY_EVENTS.mediaRequested, payload: { gameId, panels: requests } });
      }
      outbox.push({
        event: STORY_EVENTS.processing,
        payload: { gameId, panelsTotal: requests.length, panelsDone: 0 },
      });
      return { game, setPanels: panels };
    });
  }

  /**
   * Pide el título a la IA con el texto final de cada viñeta y lo guarda. Sin
   * título (IA caída o respuesta vacía) la historieta sigue sin él.
   */
  async generateTitle(gameId: string): Promise<void> {
    const snapshot = await this.getSnapshot(gameId);
    if (!snapshot.game.titlePending) return;

    const title = await this.titler.title({
      panels: closedPanels(snapshot)
        .filter((panel) => !!panel.originalText)
        .map((panel) => panel.finalText ?? ''),
      characters: castOf(snapshot).map((character) => character.name),
    });

    await this.mutate(gameId, (snapshot) => {
      const { game } = snapshot;
      if (!game.titlePending) return null;
      game.title = title;
      game.titlePending = false;
      if (!hasPendingWork(snapshot)) game.mediaDeadlineAt = null;
      return { game };
    });
    await this.advanceAfterMedia(gameId);
  }

  /**
   * Tarea `review-wait`: venció la espera de PROCESSING. El review empieza en
   * cuanto la primera viñeta tenga audio, aunque falten imágenes o el título.
   */
  async endReviewWait(gameId: string, dueAt: number): Promise<void> {
    await this.mutate(gameId, (snapshot) => {
      const { game } = snapshot;
      if (game.status !== StoryStatus.PROCESSING || game.reviewAt !== dueAt) return null;
      game.reviewAt = null;
      return { game };
    });
    await this.advanceAfterMedia(gameId);
  }

  /**
   * Audio de una viñeta (tarea `panel-audio`). Con audio la viñeta queda
   * `ready` aunque la imagen siga pendiente: la imagen llega después con otro
   * `panelMediaReady`. Se descarta si el audio ya no está `pending` (venció el
   * plazo): el primer resultado gana.
   */
  async onPanelAudio(gameId: string, order: number, audio: PanelAudioResult): Promise<void> {
    await this.mutate(gameId, (snapshot, outbox) => {
      const panel = snapshot.panels[order];
      if (!panel?.media || panel.media.status !== 'pending') return null;

      panel.media = { ...panel.media, ...audio };
      this.afterMediaSettled(snapshot, [panel], outbox);
      return { game: snapshot.game, setPanels: [panel] };
    });
    await this.advanceAfterMedia(gameId);
  }

  /**
   * Imagen de una viñeta (tarea `panel-image`). Se descarta si la imagen ya no
   * está `pending`. Si el proveedor respondió 429, las demás imágenes
   * pendientes de la historieta quedan `failed` y sus tareas no lo llaman.
   */
  async onPanelImage(
    gameId: string,
    order: number,
    { imageStatus, imageKey, rateLimited }: PanelImageResult,
  ): Promise<void> {
    await this.mutate(gameId, (snapshot, outbox) => {
      const panel = snapshot.panels[order];
      if (!panel?.media || panel.media.imageStatus !== 'pending') return null;

      panel.media = { ...panel.media, imageStatus, imageKey };
      const settled = [panel];
      if (rateLimited) {
        for (const other of closedPanels(snapshot)) {
          if (other === panel || other.media?.imageStatus !== 'pending') continue;
          other.media = { ...other.media, imageStatus: 'failed' };
          settled.push(other);
        }
        this.logger.warn(
          `story ${gameId}: image provider rate limited, ${settled.length - 1} images skipped`,
        );
      }
      this.afterMediaSettled(snapshot, settled, outbox);
      return { game: snapshot.game, setPanels: settled };
    });
    await this.advanceAfterMedia(gameId);
  }

  /**
   * Si todavía hay que dibujar la viñeta: no venció el plazo, no hubo un 429
   * en la historieta y la partida sigue en Redis. La tarea `panel-image` lo
   * consulta antes de llamar al proveedor.
   */
  async isImagePending(gameId: string, order: number): Promise<boolean> {
    const snapshot = await this.store.get(gameId);
    return snapshot?.panels[order]?.media?.imageStatus === 'pending';
  }

  /**
   * Tarea `media-deadline`: lo que siga `pending` (audio o imagen) queda
   * `failed` y la partida avanza. Un audio ya generado nunca se descarta.
   */
  async expireMedia(gameId: string, dueAt: number): Promise<void> {
    await this.mutate(gameId, (snapshot, outbox) => {
      if (snapshot.game.mediaDeadlineAt !== dueAt) return null;

      const expired = closedPanels(snapshot).filter(hasPendingMedia);
      for (const panel of expired) {
        const media = panel.media!;
        panel.media = {
          ...media,
          ...(media.status === 'pending'
            ? { status: 'failed' as const, audioKey: null, speechMarks: null }
            : {}),
          ...(media.imageStatus === 'pending'
            ? { imageStatus: 'failed' as const, imageKey: null }
            : {}),
        };
      }
      this.logger.warn(`story ${gameId}: media deadline expired (${expired.length} pending)`);
      // Un título que no llegó tampoco frena la historieta.
      snapshot.game.titlePending = false;
      this.afterMediaSettled(snapshot, expired, outbox);
      snapshot.game.mediaDeadlineAt = null;
      return { game: snapshot.game, setPanels: expired };
    });
    await this.advanceAfterMedia(gameId);
  }

  /**
   * Eventos de las viñetas que cambiaron; sin nada pendiente (audio, imagen ni
   * título) se quita el plazo. El avance de PROCESSING cuenta las viñetas con
   * audio e imagen terminados.
   */
  private afterMediaSettled(
    snapshot: StorySnapshot,
    settled: PanelState[],
    outbox: StoryOutboxItem[],
  ) {
    const { game } = snapshot;
    for (const panel of settled) {
      outbox.push({
        event: STORY_EVENTS.panelMediaReady,
        payload: { gameId: game.gameId, order: panel.order, media: panel.media! },
      });
    }
    const withMedia = closedPanels(snapshot).filter((p) => p.media && p.media.status !== 'none');
    // Una viñeta cuenta como lista cuando no le falta ni el audio ni la imagen.
    const done = withMedia.filter((p) => !hasPendingMedia(p)).length;
    if (!hasPendingWork(snapshot)) game.mediaDeadlineAt = null;
    if (game.status === StoryStatus.PROCESSING) {
      outbox.push({
        event: STORY_EVENTS.processing,
        payload: { gameId: game.gameId, panelsTotal: withMedia.length, panelsDone: done },
      });
    }
  }

  /**
   * PROCESSING -> REVIEW cuando no falta nada (audios, imágenes y título), o
   * cuando venció la espera (`reviewAt`) y la primera viñeta ya tiene su audio
   * (o falló). REVIEW -> FINISHED cuando no falta nada. Una viñeta sin `media`
   * (partida de antes de la Fase 4b) cuenta como terminada.
   */
  private async advanceAfterMedia(gameId: string): Promise<void> {
    let snapshot = await this.getSnapshot(gameId);
    const [first] = closedPanels(snapshot);
    const waitOver = snapshot.game.reviewAt === null || !hasPendingWork(snapshot);
    if (
      snapshot.game.status === StoryStatus.PROCESSING &&
      first?.media?.status !== 'pending' &&
      waitOver
    ) {
      await this.enterReview(gameId);
      snapshot = await this.getSnapshot(gameId);
    }
    if (snapshot.game.status === StoryStatus.REVIEW && !hasPendingWork(snapshot)) {
      await this.finishStory(gameId);
    }
  }

  /**
   * PROCESSING → REVIEW: emite `storyReviewReady` con el manifiesto y libera la
   * partida activa de todos los jugadores (pueden crear o unirse a otra).
   */
  async enterReview(gameId: string): Promise<void> {
    let entered = false;
    const snapshot = await this.mutate(gameId, (snapshot, outbox) => {
      const { game } = snapshot;
      if (game.status !== StoryStatus.PROCESSING) return null;

      game.status = StoryStatus.REVIEW;
      game.reviewAt = null;
      entered = true;
      outbox.push({ event: STORY_EVENTS.stateChanged, payload: { snapshot } });
      outbox.push({
        event: STORY_EVENTS.reviewReady,
        payload: { gameId, snapshot },
      });
      return { game };
    });
    if (!entered) return;

    await Promise.all(
      snapshot.game.players.map(({ userId }) => this.store.clearUserGame(userId, gameId)),
    );
  }

  /** REVIEW → FINISHED. La partida queda en Redis FINISHED_STORY_TTL_MS (ver `mutate`). */
  async finishStory(gameId: string): Promise<void> {
    await this.mutate(gameId, (snapshot, outbox) => {
      const { game } = snapshot;
      if (game.status !== StoryStatus.REVIEW) return null;

      game.status = StoryStatus.FINISHED;
      outbox.push({ event: STORY_EVENTS.stateChanged, payload: { snapshot } });
      outbox.push({ event: STORY_EVENTS.finished, payload: { snapshot } });
      this.logger.log(`story ${gameId} finished`);
      return { game };
    });
  }

  /**
   * Manifiesto del review, en REVIEW o FINISHED. Lo puede pedir cualquier
   * participante, incluso si salió de la partida.
   */
  async getReviewManifest(gameId: string, userId: string): Promise<ReviewManifest> {
    const snapshot = await this.getSnapshot(gameId);
    const { game } = snapshot;
    if (!game.players.some((player) => player.userId === userId)) throw StoryError.notAPlayer();
    if (game.status !== StoryStatus.REVIEW && game.status !== StoryStatus.FINISHED) {
      throw StoryError.invalidState('get the review', game.status);
    }
    const [avatars, media] = await Promise.all([
      this.urls.avatarsFor(game.players),
      this.urls.mediaFor(closedPanels(snapshot)),
    ]);
    return toReviewManifest(snapshot, avatars, media);
  }

  /** Estado completo de la partida tal como lo ve este jugador (reconexión). */
  async getGameState(userId: string): Promise<GameStateView> {
    const gameId = await this.store.getUserGame(userId);
    if (!gameId) throw new StoryError('NOT_IN_GAME', 'Join a story game first');
    const snapshot = await this.getSnapshot(gameId);
    this.assertActivePlayer(snapshot.game, userId);
    return toGameStateView(snapshot, userId, await this.urls.avatarsFor(snapshot.game.players));
  }

  /**
   * Salir de la partida. En LOBBY el jugador se quita de la lista; después se
   * marca `left` y se queda, porque el orden define los turnos. En PLAYING, si
   * era el autor del turno, la viñeta pasa de inmediato al siguiente; si quedan
   * menos de 2 jugadores, la partida termina con las viñetas confirmadas.
   */
  async leaveGame(gameId: string, userId: string): Promise<StorySnapshot> {
    const snapshot = await this.mutate(gameId, (snapshot, outbox) => {
      const { game } = snapshot;
      if (STORY_ENDED_STATUSES.includes(game.status)) return null;
      const player = this.assertActivePlayer(game, userId);

      this.handOverHost(game, userId);
      const changes: StoryChanges = { game };
      if (game.status === StoryStatus.LOBBY) {
        game.players = game.players.filter((other) => other.userId !== userId);
      } else {
        player.left = true;
        player.connected = false;
      }
      if (game.status === StoryStatus.PLAYING) {
        Object.assign(changes, this.afterPlayerLeftTurns(snapshot, userId, outbox));
      }
      this.onPlayerGone(game);
      return changes;
    });

    await this.store.clearUserGame(userId, gameId);
    return snapshot;
  }

  /**
   * El socket se cortó: el jugador queda desconectado (no "se fue") y puede
   * volver con `resume`. Si era anfitrión, pasa al siguiente conectado. Si era
   * el autor del turno, el turno sigue corriendo.
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
      await this.mutate(gameId, (snapshot, outbox) => {
        const { game } = snapshot;
        if (!STORY_ABANDONABLE_STATUSES.includes(game.status)) return null;
        if (game.abandonAt === null || game.abandonSeq !== seq) return null;
        if (game.players.some((player) => player.connected && !player.left)) return null;

        game.status = StoryStatus.ABANDONED;
        game.abandonAt = null;
        outbox.push({ event: STORY_EVENTS.stateChanged, payload: { snapshot } });
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
   * Lock → leer → `fn` valida y modifica la copia leída (y declara qué guardar)
   * → escritura atómica → sincronizar tareas diferidas → publicar los eventos
   * que `fn` dejó en el outbox. `fn` devuelve null si no hay nada que guardar.
   */
  private async mutate(gameId: string, fn: Mutation): Promise<StorySnapshot> {
    const outbox: StoryOutboxItem[] = [];
    const { previous, snapshot } = await this.store.withGameLock(gameId, async (lock) => {
      const snapshot = await this.getSnapshot(gameId);
      const previous = structuredClone(snapshot.game);
      const changes = fn(snapshot, outbox);
      if (!changes) return { previous, snapshot };
      // Una partida terminada se guarda más tiempo, para servir su manifiesto.
      if (snapshot.game.status === StoryStatus.FINISHED) changes.ttlMs = FINISHED_STORY_TTL_MS;

      try {
        await this.store.save(gameId, lock, changes);
      } catch (error) {
        if (error instanceof PanelGuardError) throw StoryError.turnClosed(changes.guard!.order);
        throw error;
      }
      return { previous, snapshot };
    });

    await this.syncTimers(previous, snapshot.game);
    for (const item of outbox) this.eventEmitter.emit(item.event, item.payload);
    return snapshot;
  }

  /** Tareas diferidas que corresponden a un estado de la partida. */
  private jobsOf(game: StoryGame): StoryJob[] {
    const jobs: StoryJob[] = [];
    if (game.abandonAt !== null) {
      jobs.push({
        gameId: game.gameId,
        kind: 'abandon-idle',
        seq: game.abandonSeq,
        dueAt: game.abandonAt,
      });
    }
    if (
      game.mediaDeadlineAt !== null &&
      (game.status === StoryStatus.PROCESSING || game.status === StoryStatus.REVIEW)
    ) {
      jobs.push({
        gameId: game.gameId,
        kind: 'media-deadline',
        seq: 0,
        dueAt: game.mediaDeadlineAt,
      });
    }
    if (game.reviewAt !== null && game.status === StoryStatus.PROCESSING) {
      jobs.push({ gameId: game.gameId, kind: 'review-wait', seq: 0, dueAt: game.reviewAt });
    }
    if (
      game.status === StoryStatus.PLAYING &&
      game.currentPanel !== null &&
      game.turnCloseAt !== null
    ) {
      jobs.push({
        gameId: game.gameId,
        kind: 'close-turn',
        seq: game.currentPanel,
        dueAt: game.turnCloseAt,
      });
    }
    return jobs;
  }

  /**
   * Programa las tareas nuevas y borra las que quedaron obsoletas. Borrar es
   * solo limpieza: la garantía es que cada tarea se valida con su `seq`/`dueAt`.
   */
  private async syncTimers(previous: StoryGame, next: StoryGame) {
    const before = this.jobsOf(previous);
    const after = this.jobsOf(next);
    const beforeIds = new Set(before.map(storyJobId));
    const afterIds = new Set(after.map(storyJobId));

    for (const job of before) {
      if (!afterIds.has(storyJobId(job))) this.eventEmitter.emit(STORY_CANCEL_EVENT, job);
    }
    for (const job of after) {
      // emitAsync espera al listener: si no se puede programar, el error sube.
      if (!beforeIds.has(storyJobId(job))) {
        await this.eventEmitter.emitAsync(STORY_SCHEDULE_EVENT, job);
      }
    }
  }

  /** Abre el turno de `order` para `authorId` y deja `turnStarted` en el outbox. */
  private startTurn(
    snapshot: StorySnapshot,
    order: number,
    authorId: string,
    now: number,
    outbox: StoryOutboxItem[],
  ): PanelState {
    const panel = openTurn(snapshot, order, authorId, now);
    outbox.push({
      event: STORY_EVENTS.turnStarted,
      payload: {
        gameId: snapshot.game.gameId,
        panelOrder: order,
        authorId,
        endsAt: snapshot.game.turnEndsAt!,
        storySoFar: storySoFar(snapshot),
        cast: castOf(snapshot),
      },
    });
    return panel;
  }

  /**
   * Cierra la viñeta abierta (confirmación o timeout) y avanza: abre el
   * siguiente turno o, si era la última, pasa a PROCESSING. La guarda hace que
   * Redis rechace el cierre si la viñeta ya no estaba abierta.
   */
  private closeTurn(
    snapshot: StorySnapshot,
    panel: PanelState,
    confirmedBy: PanelConfirmedBy,
    outbox: StoryOutboxItem[],
    now: number,
  ): StoryChanges {
    const { game } = snapshot;
    const confirmed = confirmPanel(snapshot, panel, confirmedBy);
    outbox.push({ event: STORY_EVENTS.panelConfirmed, payload: confirmed });

    const changes: StoryChanges = {
      game,
      setPanels: [panel],
      addCharacters: Object.fromEntries(confirmed.newCharacters.map((c) => [c.id, c])),
      guard: { order: panel.order },
    };

    const next = panel.order + 1;
    if (next >= game.config.panelsCount) {
      this.startProcessing(snapshot, outbox);
    } else {
      changes.setPanels!.push(this.startTurn(snapshot, next, authorFor(game, next), now, outbox));
    }
    return changes;
  }

  /**
   * Un jugador abandonó en PLAYING. Con menos de STORY_MIN_PLAYERS_TO_CONTINUE
   * jugadores sin abandonar (o nadie, si empezó sola), la partida termina con
   * las viñetas ya confirmadas. Si no, y era el autor del
   * turno, la viñeta se reasigna de inmediato al siguiente (con turno nuevo).
   */
  private afterPlayerLeftTurns(
    snapshot: StorySnapshot,
    userId: string,
    outbox: StoryOutboxItem[],
  ): StoryChanges {
    const { game } = snapshot;
    const current = game.currentPanel === null ? undefined : snapshot.panels[game.currentPanel];

    const minToContinue = Math.min(STORY_MIN_PLAYERS_TO_CONTINUE, game.players.length);
    if (remainingPlayers(game).length < minToContinue) {
      const changes: StoryChanges = {};
      if (current?.status === 'open') {
        delete snapshot.panels[current.order];
        changes.deletePanels = [current.order];
      }
      this.startProcessing(snapshot, outbox);
      return changes;
    }

    if (current?.status === 'open' && current.authorId === userId) {
      const leaverIndex = game.players.findIndex((player) => player.userId === userId);
      const reopened = this.startTurn(
        snapshot,
        current.order,
        nextAuthorAfter(game, leaverIndex),
        Date.now(),
        outbox,
      );
      return { setPanels: [reopened], guard: { order: current.order } };
    }
    return {};
  }

  /**
   * Fin de los turnos: PROCESSING con las viñetas confirmadas. `processingStarted`
   * dispara la generación (`onProcessingStarted`). Sin ninguna viñeta
   * confirmada no hay nada que generar y la partida se abandona.
   */
  private startProcessing(snapshot: StorySnapshot, outbox: StoryOutboxItem[]) {
    const { game } = snapshot;
    game.currentPanel = null;
    game.turnEndsAt = null;
    game.turnCloseAt = null;
    game.abandonAt = null;

    if (closedPanels(snapshot).length === 0) {
      game.status = StoryStatus.ABANDONED;
      this.logger.log(`story ${game.gameId} abandoned (no confirmed panels)`);
      outbox.push({ event: STORY_EVENTS.stateChanged, payload: { snapshot } });
      return;
    }

    game.status = StoryStatus.PROCESSING;
    // Primero el estado: la generación puede avanzar a REVIEW enseguida.
    outbox.push({ event: STORY_EVENTS.stateChanged, payload: { snapshot } });
    outbox.push({ event: STORY_EVENTS.processingStarted, payload: { gameId: game.gameId } });
  }

  private pushAuthorStatus(
    snapshot: StorySnapshot,
    panel: PanelState,
    now: number,
    outbox: StoryOutboxItem[],
  ) {
    outbox.push({
      event: STORY_EVENTS.authorStatus,
      payload: {
        gameId: snapshot.game.gameId,
        order: panel.order,
        status: authorStatusOf(panel, now),
      },
    });
  }

  /** La IA nunca bloquea la partida: cualquier fallo es "sin revisión". */
  private async reviewSafely(input: LanguageReviewInput): Promise<LanguageReview | null> {
    try {
      return await this.reviewer.review(input);
    } catch (error) {
      this.logger.warn(`language review failed: ${(error as Error).message}`);
      return null;
    }
  }

  private reviewResult(
    panel: PanelState,
    review: LanguageReview | null,
    { message }: { message?: string } = {},
  ): PanelReviewResultView {
    return {
      panelOrder: panel.order,
      flagged: review?.flagged ?? false,
      reviewAvailable: review !== null,
      corrections: review?.flagged ? [] : (review?.corrections ?? []),
      characterCorrections: review?.flagged ? [] : (review?.characterCorrections ?? []),
      attemptsLeft: MAX_REVIEW_ATTEMPTS - panel.attempts,
      ...(message ? { message } : {}),
    };
  }

  /** El turno en curso es `panelOrder`, está abierto y `userId` es su autor. */
  private assertAuthorTurn(
    snapshot: StorySnapshot,
    userId: string,
    panelOrder: number,
  ): PanelState {
    const { game } = snapshot;
    if (game.status !== StoryStatus.PLAYING) {
      throw StoryError.invalidState('write a panel', game.status);
    }
    const panel = snapshot.panels[panelOrder];
    if (game.currentPanel !== panelOrder || panel?.status !== 'open') {
      throw StoryError.turnClosed(panelOrder);
    }
    if (panel.authorId !== userId) {
      throw new StoryError('NOT_YOUR_TURN', 'It is not your turn', HttpStatus.FORBIDDEN);
    }
    return panel;
  }

  /** Una revisión en curso bloquea otro borrador o confirmar, salvo que se haya perdido. */
  private assertNotReviewing(panel: PanelState, now: number) {
    if (panel.reviewing && now - panel.reviewing.startedAt < REVIEW_STALE_MS) {
      throw new StoryError(
        'REVIEW_IN_PROGRESS',
        'Your previous draft is still being reviewed',
        HttpStatus.CONFLICT,
      );
    }
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
    const user = await this.users.findOne({ where: { id: userId }, relations: ['avatar'] });
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
