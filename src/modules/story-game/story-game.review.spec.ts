import { Correction } from '@/modules/language-review/language-review.types';
import { StoryGameService } from './story-game.service';
import {
  ProcessingStartedEvent,
  ReviewReadyEvent,
  STORY_EVENTS,
  StoryStateChangedEvent,
} from './domain/story-game.events';
import { DraftInput, StoryStatus } from './domain/story-game.types';
import { toReviewManifest } from './domain/story-review';
import { FINISHED_STORY_TTL_MS, OUT_OF_TIME_TEXT } from './story-game.config';
import {
  createStoryHarness,
  expectStoryError,
  InMemoryStoryStore,
} from '../../../test/story-game/story-harness';

/** 10 palabras. */
const TEXT = 'The little robot walked slowly into the dark forest tonight.';
const WALK_TEXT = 'The little robot walk slowly into the dark forest tonight.';
const CORRECTION: Correction = {
  original: 'walk',
  suggestion: 'walked',
  type: 'grammar',
  explanation: 'Pasado simple.',
};
const draft = (overrides: Partial<DraftInput> = {}): DraftInput => ({
  text: TEXT,
  scene: 'A dark forest at night',
  characterIds: [],
  newCharacters: [],
  ...overrides,
});

describe('StoryGameService — end of the story (phase 4a)', () => {
  const T0 = 1_800_000_000_000;
  let h: ReturnType<typeof createStoryHarness>;
  let service: StoryGameService;
  let store: InMemoryStoryStore;

  beforeEach(() => {
    h = createStoryHarness(T0);
    ({ service, store } = h);
  });

  afterEach(() => jest.restoreAllMocks());

  /** Manifiesto tal como lo arma el gateway con cada `reviewReady` (sin avatares). */
  const reviewReady = () =>
    h
      .emitted<ReviewReadyEvent>(STORY_EVENTS.reviewReady)
      .map(({ gameId, snapshot }) => ({ gameId, manifest: toReviewManifest(snapshot) }));
  const statuses = () =>
    h
      .emitted<StoryStateChangedEvent>(STORY_EVENTS.stateChanged)
      .map(({ snapshot }) => snapshot.game.status);

  /**
   * Con el EventEmitter falso del harness los listeners no corren solos: esto
   * hace lo que hace `@OnEvent(processingStarted)` en la app.
   */
  async function runProcessing() {
    for (const event of h.emitted<ProcessingStartedEvent>(STORY_EVENTS.processingStarted)) {
      await service.onProcessingStarted(event);
    }
  }

  /** El autor del turno en curso envía `input` y confirma. */
  async function writePanel(gameId: string, input: Partial<DraftInput> = {}) {
    const { currentPanel } = await h.gameOf(gameId);
    const { authorId } = (await h.snapshotOf(gameId)).panels[currentPanel!];
    await service.submitPanelDraft(gameId, authorId, currentPanel!, draft(input));
    await service.confirmPanel(gameId, authorId, currentPanel!);
    return authorId;
  }

  /** alice, bob y carol; 4 viñetas: alice escribe la 0 y la 3. */
  async function storyOfFour() {
    const gameId = await h.lobbyWith('alice', 'bob', 'carol');
    await service.updateConfig(gameId, 'alice', { panelsCount: 4 });
    await service.startStory(gameId, 'alice');
    return gameId;
  }

  /**
   * alice: 150 (perfecta) + 0 (venció sin texto) → total 150, promedio 75.
   * bob:   150 (perfecta)                         → total 150, promedio 150.
   * carol: 70 (1 error en 10 palabras)            → total 70,  promedio 70.
   */
  async function playScoredStory() {
    const gameId = await storyOfFour();
    await writePanel(gameId, {
      newCharacters: [{ name: 'Beep', kind: 'robot', description: 'tiny' }],
    });
    await writePanel(gameId, { characterIds: ['ch-0-0'] });
    h.reviewer.review.mockResolvedValueOnce({
      correctedText: TEXT,
      corrections: [CORRECTION],
      characterCorrections: [],
      flagged: false,
    });
    await writePanel(gameId, { text: WALK_TEXT });

    const { turnCloseAt } = await h.gameOf(gameId);
    h.clock.now = turnCloseAt!;
    await service.closeTurnByTimeout(gameId, 3, turnCloseAt!);
    return gameId;
  }

  it('goes from the last confirmed panel to storyReviewReady and FINISHED', async () => {
    const gameId = await playScoredStory();
    expect((await h.gameOf(gameId)).status).toBe(StoryStatus.PROCESSING);
    expect(h.emitted(STORY_EVENTS.processingStarted)).toEqual([{ gameId }]);

    await runProcessing();

    expect(statuses().slice(-3)).toEqual([
      StoryStatus.PROCESSING,
      StoryStatus.REVIEW,
      StoryStatus.FINISHED,
    ]);
    expect((await h.gameOf(gameId)).status).toBe(StoryStatus.FINISHED);
    expect(reviewReady()).toHaveLength(1);

    const { manifest } = reviewReady()[0];
    expect(manifest).toMatchObject({ storyId: gameId, gameId });
    expect(manifest.characters).toEqual([
      {
        id: 'ch-0-0',
        name: 'Beep',
        kind: 'robot',
        description: 'tiny',
        createdBy: 'alice',
        introducedInPanel: 0,
      },
    ]);
    expect(manifest.panels.map((panel) => panel.author)).toEqual([
      { id: 'alice', name: 'name-alice' },
      { id: 'bob', name: 'name-bob' },
      { id: 'carol', name: 'name-carol' },
      { id: 'alice', name: 'name-alice' },
    ]);
    expect(manifest.panels[2]).toEqual({
      order: 2,
      author: { id: 'carol', name: 'name-carol' },
      originalText: WALK_TEXT,
      finalText: TEXT,
      scene: 'A dark forest at night',
      characterIds: [],
      corrections: [CORRECTION],
      score: {
        accuracy: 70,
        firstTryBonus: 0,
        selfCorrectionBonus: 0,
        timeoutPenalty: false,
        total: 70,
      },
      reactions: {},
      audioUrl: null,
      speechMarks: null,
      imageUrl: null,
      mediaStatus: 'none',
    });
    expect(manifest.panels[1].characterIds).toEqual(['ch-0-0']);
    expect(manifest.panels[3]).toMatchObject({
      originalText: '',
      finalText: OUT_OF_TIME_TEXT,
      score: { total: 0 },
    });
  });

  it('keeps the avatar key of each player and signs it for the manifest', async () => {
    (h.users.findOne as jest.Mock).mockImplementation(
      ({ where: { id } }: { where: { id: string } }) =>
        Promise.resolve({ id, username: `name-${id}`, avatar: { key: `avatar/${id}.png` } }),
    );
    h.avatars.urlsFor.mockResolvedValue({ bob: 'https://signed/bob' });
    const gameId = await playScoredStory();
    await runProcessing();

    const { game } = await h.snapshotOf(gameId);
    expect(game.players.map((player) => player.avatarKey)).toEqual([
      'avatar/alice.png',
      'avatar/bob.png',
      'avatar/carol.png',
    ]);
    const { ranking } = await service.getReviewManifest(gameId, 'alice');
    expect(h.avatars.urlsFor).toHaveBeenLastCalledWith(game.players);
    expect(ranking.map((entry) => [entry.userId, entry.avatarUrl])).toEqual([
      ['bob', 'https://signed/bob'],
      ['alice', null],
      ['carol', null],
    ]);
  });

  it('ranks the players by their average score per panel', async () => {
    const gameId = await playScoredStory();
    await runProcessing();

    expect(reviewReady()[0].manifest.ranking).toEqual([
      {
        userId: 'bob',
        name: 'name-bob',
        avatarUrl: null,
        panelsWritten: 1,
        totalScore: 150,
        averageScore: 150,
      },
      {
        userId: 'alice',
        name: 'name-alice',
        avatarUrl: null,
        panelsWritten: 2,
        totalScore: 150,
        averageScore: 75,
      },
      {
        userId: 'carol',
        name: 'name-carol',
        avatarUrl: null,
        panelsWritten: 1,
        totalScore: 70,
        averageScore: 70,
      },
    ]);
    expect((await service.getReviewManifest(gameId, 'carol')).ranking).toEqual(
      reviewReady()[0].manifest.ranking,
    );
  });

  it('puts players who wrote nothing at the end of the ranking', async () => {
    const gameId = await h.playingWith('alice', 'bob', 'carol');
    await writePanel(gameId);
    await service.leaveGame(gameId, 'carol');
    await service.leaveGame(gameId, 'bob');
    await runProcessing();

    const ranking = (await service.getReviewManifest(gameId, 'bob')).ranking;
    expect(ranking.map(({ userId, averageScore }) => [userId, averageScore])).toEqual([
      ['alice', 150],
      ['bob', 0],
      ['carol', 0],
    ]);
  });

  it('frees every player to create or join another game once in REVIEW', async () => {
    const gameId = await playScoredStory();
    await expectStoryError(service.createGame('bob'), 'ALREADY_IN_GAME');

    await runProcessing();

    expect(store.userGames.size).toBe(0);
    const { game } = await service.createGame('bob');
    await service.joinGame(game.gameId, 'carol');
    expect(await store.getUserGame('bob')).toBe(game.gameId);
    expect(await store.getUserGame('carol')).toBe(game.gameId);
    expect(await store.getUserGame('alice')).toBeNull();
    expect(game.gameId).not.toBe(gameId);
  });

  it('does not touch a player who already moved on to another game', async () => {
    const gameId = await playScoredStory();
    await service.leaveGame(gameId, 'carol');
    const { game: other } = await service.createGame('carol');

    await runProcessing();
    expect(await store.getUserGame('carol')).toBe(other.gameId);
  });

  it('keeps a FINISHED story for FINISHED_STORY_TTL_MS, also after later reactions', async () => {
    const gameId = await playScoredStory();
    expect(store.ttls.get(gameId)).toBeUndefined();

    await runProcessing();
    expect(store.ttls.get(gameId)).toBe(FINISHED_STORY_TTL_MS);

    await service.reactToPanel(gameId, 'bob', 0, '👏');
    expect(store.ttls.get(gameId)).toBe(FINISHED_STORY_TTL_MS);
    expect((await service.getReviewManifest(gameId, 'alice')).panels[0].reactions).toEqual({
      bob: '👏',
    });
  });

  it('runs the transition only once', async () => {
    const gameId = await playScoredStory();
    await runProcessing();
    await service.onProcessingStarted({ gameId });

    expect(reviewReady()).toHaveLength(1);
    expect(statuses().filter((status) => status === StoryStatus.FINISHED)).toHaveLength(1);
  });

  it('also ends a story that finished early because players left', async () => {
    const gameId = await h.playingWith('alice', 'bob');
    await writePanel(gameId);
    await service.leaveGame(gameId, 'bob');
    await runProcessing();

    expect((await h.gameOf(gameId)).status).toBe(StoryStatus.FINISHED);
    expect(reviewReady()[0].manifest.panels).toHaveLength(1);
  });

  describe('getReviewManifest', () => {
    it('serves any participant, even one who left', async () => {
      const gameId = await h.playingWith('alice', 'bob', 'carol');
      await writePanel(gameId);
      await service.leaveGame(gameId, 'carol');
      await service.leaveGame(gameId, 'bob');
      await runProcessing();

      await expect(service.getReviewManifest(gameId, 'carol')).resolves.toMatchObject({
        storyId: gameId,
      });
    });

    it('rejects outsiders', async () => {
      const gameId = await playScoredStory();
      await runProcessing();
      await expectStoryError(service.getReviewManifest(gameId, 'mallory'), 'NOT_A_PLAYER');
    });

    it('is not available before REVIEW', async () => {
      const gameId = await playScoredStory();
      await expectStoryError(service.getReviewManifest(gameId, 'alice'), 'INVALID_STATE');
    });

    it('reports an unknown or expired game', async () => {
      await expectStoryError(service.getReviewManifest('nope', 'alice'), 'GAME_NOT_FOUND');
    });
  });

  describe('scoreboard in gameState', () => {
    it('lets a reconnecting player rebuild the scores', async () => {
      const gameId = await storyOfFour();
      await writePanel(gameId);
      h.reviewer.review.mockResolvedValueOnce({
        correctedText: TEXT,
        corrections: [CORRECTION],
        characterCorrections: [],
        flagged: false,
      });
      await writePanel(gameId, { text: WALK_TEXT });

      await service.disconnect(gameId, 'carol');
      await service.resume('carol');
      const { scoreboard } = await service.getGameState('carol');
      expect(scoreboard).toEqual([
        {
          userId: 'alice',
          name: 'name-alice',
          avatarUrl: null,
          panelsWritten: 1,
          totalScore: 150,
          averageScore: 150,
        },
        {
          userId: 'bob',
          name: 'name-bob',
          avatarUrl: null,
          panelsWritten: 1,
          totalScore: 70,
          averageScore: 70,
        },
        {
          userId: 'carol',
          name: 'name-carol',
          avatarUrl: null,
          panelsWritten: 0,
          totalScore: 0,
          averageScore: 0,
        },
      ]);
    });
  });
});
