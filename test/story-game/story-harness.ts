import { Repository } from 'typeorm';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { User } from '@/db/entities';
import { LockHandle } from '@/common/src/redis/redis-lock.service';
import { UniqueNamesAdapter } from '@/common/src/unique-names/unique-names.adapter';
import { LanguageReviewer } from '@/modules/language-review/language-reviewer';
import { StoryTitleInput, StoryTitler } from '@/modules/language-review/story-titler';
import {
  LanguageReview,
  LanguageReviewInput,
} from '@/modules/language-review/language-review.types';
import { StoryGameService } from '@/modules/story-game/story-game.service';
import { StoryUrlSigner } from '@/modules/story-game/story-url-signer.service';
import {
  PanelGuardError,
  StoryChanges,
  StoryStateRepository,
} from '@/modules/story-game/story-state.repository';
import { PanelMedia, StoryGame, StorySnapshot } from '@/modules/story-game/domain/story-game.types';
import { MediaRequestedEvent, STORY_EVENTS } from '@/modules/story-game/domain/story-game.events';
import { StoryError, StoryErrorCode } from '@/modules/story-game/domain/story-game.errors';
import {
  STORY_CANCEL_EVENT,
  STORY_SCHEDULE_EVENT,
  StoryJob,
} from '@/modules/story-game/queue/type';

/**
 * Redis en memoria con la misma interfaz que StoryStateRepository. Guarda JSON
 * (cada lectura es una copia, como en Redis), serializa withGameLock y emula
 * la guarda del script Lua (viñeta abierta y misma revisión en curso).
 */
export class InMemoryStoryStore {
  games = new Map<string, string>();
  userGames = new Map<string, string>();
  /** TTL de la última escritura de cada partida (undefined = MATCH_TTL). */
  ttls = new Map<string, number | undefined>();
  /** false simula un lock perdido: las operaciones se intercalan y solo queda la guarda. */
  serialize = true;
  private queue: Promise<unknown> = Promise.resolve();

  get(gameId: string): Promise<StorySnapshot | null> {
    const raw = this.games.get(gameId);
    return Promise.resolve(raw ? (JSON.parse(raw) as StorySnapshot) : null);
  }

  create(game: StoryGame): Promise<boolean> {
    if (this.games.has(game.gameId)) return Promise.resolve(false);
    this.games.set(game.gameId, JSON.stringify({ game, characters: {}, panels: {} }));
    return Promise.resolve(true);
  }

  save(gameId: string, _lock: LockHandle, changes: StoryChanges): Promise<void> {
    // Leer, chequear y escribir sin ningún await en el medio: atómico, como el
    // script Lua en Redis.
    const snapshot = JSON.parse(this.games.get(gameId)!) as StorySnapshot;

    // Mismo chequeo que FENCED_WRITE_SCRIPT, antes de escribir nada.
    if (changes.guard) {
      const panel = snapshot.panels[changes.guard.order];
      const attemptOk =
        changes.guard.attemptId === undefined ||
        panel?.reviewing?.attemptId === changes.guard.attemptId;
      if (panel?.status !== 'open' || !attemptOk) {
        return Promise.reject(new PanelGuardError(gameId, changes.guard.order));
      }
    }

    if (changes.game) snapshot.game = changes.game;
    Object.assign(snapshot.characters, changes.addCharacters);
    for (const panel of changes.setPanels ?? []) snapshot.panels[panel.order] = panel;
    for (const order of changes.deletePanels ?? []) delete snapshot.panels[order];
    this.games.set(gameId, JSON.stringify(snapshot));
    this.ttls.set(gameId, changes.ttlMs);
    return Promise.resolve();
  }

  withGameLock<T>(gameId: string, fn: (lock: LockHandle) => Promise<T>): Promise<T> {
    const lock = { key: `lock:${gameId}`, token: 't' };
    if (!this.serialize) return fn(lock);
    const run = this.queue.then(() => fn(lock));
    this.queue = run.catch(() => undefined);
    return run;
  }

  setUserGame(userId: string, gameId: string): Promise<void> {
    this.userGames.set(userId, gameId);
    return Promise.resolve();
  }

  getUserGame(userId: string): Promise<string | null> {
    return Promise.resolve(this.userGames.get(userId) ?? null);
  }

  clearUserGame(userId: string, gameId: string): Promise<void> {
    if (this.userGames.get(userId) === gameId) this.userGames.delete(userId);
    return Promise.resolve();
  }

  /** Escribe el estado directo (para llevar la partida a estados de fases posteriores). */
  async patch(gameId: string, fn: (snapshot: StorySnapshot) => void) {
    const snapshot = (await this.get(gameId))!;
    fn(snapshot);
    this.games.set(gameId, JSON.stringify(snapshot));
  }
}

export type EmitCall = [string, unknown];

/** StoryGameService con Redis en memoria, reloj controlado y dependencias falsas. */
export function createStoryHarness(start = 1_800_000_000_000) {
  const clock = { now: start };
  jest.spyOn(Date, 'now').mockImplementation(() => clock.now);

  const store = new InMemoryStoryStore();
  const events = { emit: jest.fn(), emitAsync: jest.fn().mockResolvedValue([]) };
  const reviewer = {
    review: jest.fn<Promise<LanguageReview | null>, [LanguageReviewInput]>((input) =>
      Promise.resolve({
        correctedText: input.text,
        corrections: [],
        characterCorrections: [],
        flagged: false,
      }),
    ),
  };
  const titler = {
    title: jest.fn<Promise<string | null>, [StoryTitleInput]>(() =>
      Promise.resolve('The Robot Adventure'),
    ),
  };
  let nextName = 0;

  const users = {
    findOne: jest.fn(({ where: { id } }: { where: { id: string } }) =>
      Promise.resolve(id === 'ghost' ? null : ({ id, username: `name-${id}` } as User)),
    ),
  } as unknown as Repository<User>;
  const uniqueNames = { NamesGenerator: () => `game-${++nextName}` } as UniqueNamesAdapter;

  const urls = {
    avatarsFor: jest.fn().mockResolvedValue({}),
    mediaFor: jest.fn().mockResolvedValue({}),
    signMedia: jest.fn().mockResolvedValue({ audioUrl: null, imageUrl: null }),
  };

  const service = new StoryGameService(
    store as unknown as StoryStateRepository,
    users,
    uniqueNames,
    events as unknown as EventEmitter2,
    reviewer as unknown as LanguageReviewer,
    urls as unknown as StoryUrlSigner,
    titler as unknown as StoryTitler,
  );

  /** Partida con `ids` en orden de entrada; el primero es el anfitrión. */
  async function lobbyWith(...ids: string[]): Promise<string> {
    const { game } = await service.createGame(ids[0]);
    for (const id of ids.slice(1)) await service.joinGame(game.gameId, id);
    return game.gameId;
  }

  async function playingWith(...ids: string[]): Promise<string> {
    const gameId = await lobbyWith(...ids);
    await service.startStory(gameId, ids[0]);
    return gameId;
  }

  /**
   * Hace lo que harían la cola `story-media` y su processor: cada viñeta
   * pedida en `mediaRequested` que siga `pending` recibe el audio y después la
   * imagen de `media(order)` (por defecto, audio listo sin imagen). `orders` limita a esas viñetas.
   */
  async function completeMedia(
    media: (order: number) => PanelMedia = (order) => ({
      status: 'ready',
      audioKey: `story/s/panel-${order}.mp3`,
      imageKey: null,
      imageStatus: 'none',
      speechMarks: [],
    }),
    orders?: number[],
  ) {
    const requested = (events.emit.mock.calls as EmitCall[])
      .filter(([name]) => name === STORY_EVENTS.mediaRequested)
      .map(([, payload]) => payload as MediaRequestedEvent);
    for (const { gameId, panels } of requested) {
      for (const { order } of panels) {
        if (orders && !orders.includes(order)) continue;
        const { status, audioKey, imageKey, imageStatus, speechMarks } = media(order);
        await service.onPanelAudio(gameId, order, {
          status: status === 'failed' ? 'failed' : 'ready',
          audioKey,
          speechMarks,
        });
        await service.onPanelImage(gameId, order, {
          imageStatus: imageStatus === 'ready' || imageStatus === 'failed' ? imageStatus : 'none',
          imageKey,
        });
      }
    }
  }

  const snapshotOf = (gameId: string) => service.getSnapshot(gameId);
  const gameOf = async (gameId: string) => (await snapshotOf(gameId)).game;
  /** Payloads emitidos con `event` (el test sabe de qué tipo son). */
  const emitted = <T = unknown>(event: string): T[] =>
    (events.emit.mock.calls as EmitCall[])
      .filter(([name]) => name === event)
      .map(([, payload]) => payload as T);
  /** Llamadas de programar/cancelar tareas, opcionalmente de un solo `kind`. */
  const jobCalls = (calls: EmitCall[], event: string, kind?: string) =>
    calls.filter(
      ([name, job]) => name === event && (kind === undefined || (job as StoryJob).kind === kind),
    );
  const scheduled = (kind?: StoryJob['kind']) =>
    jobCalls(events.emitAsync.mock.calls as EmitCall[], STORY_SCHEDULE_EVENT, kind);
  const cancelled = (kind?: StoryJob['kind']) =>
    jobCalls(events.emit.mock.calls as EmitCall[], STORY_CANCEL_EVENT, kind);

  return {
    clock,
    store,
    events,
    reviewer,
    titler,
    users,
    urls,
    service,
    lobbyWith,
    playingWith,
    completeMedia,
    snapshotOf,
    gameOf,
    emitted,
    scheduled,
    cancelled,
  };
}

export async function expectStoryError(promise: Promise<unknown>, code: StoryErrorCode) {
  await expect(promise).rejects.toBeInstanceOf(StoryError);
  await promise.catch((error: StoryError) => expect(error.code).toBe(code));
}
