import { LanguageReview } from '@/modules/language-review/language-review.types';
import { StoryGameService } from './story-game.service';
import { STORY_EVENTS, PanelConfirmedEvent, TurnStartedEvent } from './domain/story-game.events';
import { CharacterSheet, DraftInput, StoryStatus } from './domain/story-game.types';
import { OUT_OF_TIME_TEXT, REVIEW_STALE_MS } from './story-game.config';
import {
  createStoryHarness,
  expectStoryError,
  InMemoryStoryStore,
} from '../../../test/story-game/story-harness';

const TEXT = 'The little robot walked slowly into the dark forest tonight.';
const draft = (overrides: Partial<DraftInput> = {}): DraftInput => ({
  text: TEXT,
  scene: 'A dark forest at night',
  characterIds: [],
  newCharacters: [],
  ...overrides,
});
const sheet = (name: string): CharacterSheet => ({
  name,
  kind: 'robot',
  description: 'small silver robot with a blue light',
});

/** Promesa que el test resuelve cuando quiere (para dejar una revisión "en curso"). */
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

describe('StoryGameService — turns', () => {
  const T0 = 1_800_000_000_000;
  const TURN_MS = 90_000;
  let h: ReturnType<typeof createStoryHarness>;
  let service: StoryGameService;
  let store: InMemoryStoryStore;

  beforeEach(() => {
    h = createStoryHarness(T0);
    ({ service, store } = h);
  });

  afterEach(() => jest.restoreAllMocks());

  const turnsStarted = () => h.emitted<TurnStartedEvent>(STORY_EVENTS.turnStarted);
  const confirmed = () => h.emitted<PanelConfirmedEvent>(STORY_EVENTS.panelConfirmed);
  const panelOf = async (gameId: string, order: number) =>
    (await h.snapshotOf(gameId)).panels[order];

  /** El autor del turno en curso envía un borrador y confirma. */
  async function writePanel(gameId: string, overrides: Partial<DraftInput> = {}) {
    const { currentPanel } = await h.gameOf(gameId);
    const { authorId } = await panelOf(gameId, currentPanel!);
    await service.submitPanelDraft(gameId, authorId, currentPanel!, draft(overrides));
    await service.confirmPanel(gameId, authorId, currentPanel!);
  }

  describe('opening turns', () => {
    it('opens panel 0 for the first player when the story starts', async () => {
      const gameId = await h.playingWith('alice', 'bob');

      expect(turnsStarted()).toEqual([
        {
          gameId,
          panelOrder: 0,
          authorId: 'alice',
          endsAt: T0 + TURN_MS,
          storySoFar: [],
          cast: [],
        },
      ]);
      expect(h.scheduled('close-turn')).toEqual([
        ['story.schedule', { gameId, kind: 'close-turn', seq: 0, dueAt: T0 + TURN_MS }],
      ]);
    });

    it('announces PLAYING before the first turn', async () => {
      await h.playingWith('alice', 'bob');
      const order = h.events.emit.mock.calls.map(([name]) => name as string);
      expect(order.indexOf(STORY_EVENTS.stateChanged)).toBeLessThan(
        order.indexOf(STORY_EVENTS.turnStarted),
      );
    });

    it('rotates authors as players[i % n]', async () => {
      const gameId = await h.playingWith('alice', 'bob');
      await writePanel(gameId);
      await writePanel(gameId);
      await writePanel(gameId);
      expect(turnsStarted().map((turn) => turn.authorId)).toEqual(['alice', 'bob', 'alice', 'bob']);
    });

    it('sends the story so far and the cast with each new turn', async () => {
      const gameId = await h.playingWith('alice', 'bob');
      await writePanel(gameId, { newCharacters: [sheet('Beep')] });

      const second = turnsStarted()[1];
      expect(second.storySoFar).toEqual([
        {
          order: 0,
          authorId: 'alice',
          finalText: TEXT,
          scene: 'A dark forest at night',
          characterIds: ['ch-0-0'],
        },
      ]);
      expect(second.cast.map((character) => character.name)).toEqual(['Beep']);
    });
  });

  describe('submitPanelDraft', () => {
    it('only the author can send drafts', async () => {
      const gameId = await h.playingWith('alice', 'bob');
      await expectStoryError(service.submitPanelDraft(gameId, 'bob', 0, draft()), 'NOT_YOUR_TURN');
    });

    it('rejects a draft for a panel that is not the current one', async () => {
      const gameId = await h.playingWith('alice', 'bob');
      await expectStoryError(service.submitPanelDraft(gameId, 'alice', 1, draft()), 'TURN_CLOSED');
    });

    it('needs MIN_WORDS_PER_PANEL words', async () => {
      const gameId = await h.playingWith('alice', 'bob');
      await expectStoryError(
        service.submitPanelDraft(gameId, 'alice', 0, draft({ text: 'Too short to count.' })),
        'INVALID_DRAFT',
      );
    });

    it('rejects drafts once the turn time is over', async () => {
      const gameId = await h.playingWith('alice', 'bob');
      h.clock.now = T0 + TURN_MS + 1;
      await expectStoryError(service.submitPanelDraft(gameId, 'alice', 0, draft()), 'TURN_EXPIRED');
    });

    it('rejects the third draft of the same panel', async () => {
      const gameId = await h.playingWith('alice', 'bob');
      const first = await service.submitPanelDraft(gameId, 'alice', 0, draft());
      const second = await service.submitPanelDraft(gameId, 'alice', 0, draft());

      expect([first.attemptsLeft, second.attemptsLeft]).toEqual([1, 0]);
      await expectStoryError(
        service.submitPanelDraft(gameId, 'alice', 0, draft()),
        'NO_ATTEMPTS_LEFT',
      );
    });

    it('never sends the corrected text to the player', async () => {
      h.reviewer.review.mockResolvedValue({
        correctedText: 'SECRET corrected text',
        corrections: [
          { original: 'walked', suggestion: 'walks', type: 'grammar', explanation: 'Presente.' },
        ],
        characterCorrections: [],
        flagged: false,
      });
      const gameId = await h.playingWith('alice', 'bob');
      const result = await service.submitPanelDraft(gameId, 'alice', 0, draft());
      const state = await service.getGameState('alice');

      expect(JSON.stringify(result)).not.toContain('SECRET');
      expect(JSON.stringify(state)).not.toContain('SECRET');
      expect(result.corrections).toHaveLength(1);
    });

    it('a flagged draft is rejected without using an attempt', async () => {
      h.reviewer.review.mockResolvedValue({
        correctedText: TEXT,
        corrections: [],
        characterCorrections: [],
        flagged: true,
      });
      const gameId = await h.playingWith('alice', 'bob');
      const result = await service.submitPanelDraft(gameId, 'alice', 0, draft());

      expect(result).toMatchObject({ flagged: true, attemptsLeft: 2 });
      expect(result.message).toBeDefined();
      const panel = await panelOf(gameId, 0);
      expect(panel.drafts).toHaveLength(0);
      expect(panel.reviewing).toBeNull();
    });

    it('keeps the draft without using an attempt when the review is unavailable', async () => {
      h.reviewer.review.mockResolvedValueOnce(null);
      h.reviewer.review.mockRejectedValueOnce(new Error('bedrock down'));
      const gameId = await h.playingWith('alice', 'bob');

      const first = await service.submitPanelDraft(gameId, 'alice', 0, draft());
      const second = await service.submitPanelDraft(gameId, 'alice', 0, draft());

      expect([first.reviewAvailable, second.reviewAvailable]).toEqual([false, false]);
      expect(second.attemptsLeft).toBe(2);
      expect((await panelOf(gameId, 0)).drafts).toHaveLength(2);
    });

    it('rejects another draft (or confirming) while a review is in progress', async () => {
      const gameId = await h.playingWith('alice', 'bob');
      await service.submitPanelDraft(gameId, 'alice', 0, draft());
      const pending = deferred<LanguageReview | null>();
      h.reviewer.review.mockReturnValueOnce(pending.promise);

      const inFlight = service.submitPanelDraft(gameId, 'alice', 0, draft());
      await new Promise((resolve) => setImmediate(resolve));
      await expectStoryError(
        service.submitPanelDraft(gameId, 'alice', 0, draft()),
        'REVIEW_IN_PROGRESS',
      );
      await expectStoryError(service.confirmPanel(gameId, 'alice', 0), 'REVIEW_IN_PROGRESS');

      pending.resolve(null);
      await expect(inFlight).resolves.toMatchObject({ reviewAvailable: false });
    });

    it('lets the author retry after a lost review, and drops the lost result', async () => {
      const gameId = await h.playingWith('alice', 'bob');
      const lost = deferred<LanguageReview | null>();
      h.reviewer.review.mockReturnValueOnce(lost.promise);
      const lostSubmit = service.submitPanelDraft(gameId, 'alice', 0, draft());
      await new Promise((resolve) => setImmediate(resolve));

      h.clock.now = T0 + REVIEW_STALE_MS;
      await service.submitPanelDraft(gameId, 'alice', 0, draft({ scene: 'Retry scene' }));

      lost.resolve(null);
      await expectStoryError(lostSubmit, 'TURN_CLOSED');
      const panel = await panelOf(gameId, 0);
      expect(panel.drafts.map((d) => d.scene)).toEqual(['Retry scene']);
    });
  });

  describe('characters', () => {
    it('new characters join the cast only when the panel is confirmed', async () => {
      const gameId = await h.playingWith('alice', 'bob');
      await service.submitPanelDraft(gameId, 'alice', 0, draft({ newCharacters: [sheet('Beep')] }));
      expect((await h.snapshotOf(gameId)).characters).toEqual({});

      await service.confirmPanel(gameId, 'alice', 0);
      expect(Object.values((await h.snapshotOf(gameId)).characters)).toEqual([
        {
          id: 'ch-0-0',
          ...sheet('Beep'),
          createdBy: 'alice',
          introducedInPanel: 0,
        },
      ]);
      expect(confirmed()[0]).toMatchObject({
        characterIds: ['ch-0-0'],
        newCharacters: [expect.objectContaining({ name: 'Beep' })],
      });
    });

    it('drops characters of a draft that was replaced before confirming', async () => {
      const gameId = await h.playingWith('alice', 'bob');
      await service.submitPanelDraft(gameId, 'alice', 0, draft({ newCharacters: [sheet('Beep')] }));
      await service.submitPanelDraft(gameId, 'alice', 0, draft());
      await service.confirmPanel(gameId, 'alice', 0);

      expect((await h.snapshotOf(gameId)).characters).toEqual({});
      expect(confirmed()[0].characterIds).toEqual([]);
    });

    it('lets a panel mark existing characters and add new ones', async () => {
      const gameId = await h.playingWith('alice', 'bob');
      await writePanel(gameId, { newCharacters: [sheet('Beep')] });
      await writePanel(gameId, { characterIds: ['ch-0-0'], newCharacters: [sheet('Max')] });

      expect(confirmed()[1].characterIds).toEqual(['ch-0-0', 'ch-1-0']);
    });

    it('accepts a panel with no characters', async () => {
      const gameId = await h.playingWith('alice', 'bob');
      await writePanel(gameId);
      expect(confirmed()[0].characterIds).toEqual([]);
    });

    it('rejects an unknown characterId', async () => {
      const gameId = await h.playingWith('alice', 'bob');
      await expectStoryError(
        service.submitPanelDraft(gameId, 'alice', 0, draft({ characterIds: ['ch-9-9'] })),
        'UNKNOWN_CHARACTER',
      );
    });

    it('rejects a name already in the cast, ignoring case', async () => {
      const gameId = await h.playingWith('alice', 'bob');
      await writePanel(gameId, { newCharacters: [sheet('Beep')] });
      await expectStoryError(
        service.submitPanelDraft(gameId, 'bob', 1, draft({ newCharacters: [sheet(' BEEP ')] })),
        'DUPLICATE_CHARACTER_NAME',
      );
    });

    it('rejects two new characters with the same name', async () => {
      const gameId = await h.playingWith('alice', 'bob');
      await expectStoryError(
        service.submitPanelDraft(
          gameId,
          'alice',
          0,
          draft({ newCharacters: [sheet('Max'), sheet('max')] }),
        ),
        'DUPLICATE_CHARACTER_NAME',
      );
    });

    it('rejects going over MAX_CHARACTERS_PER_STORY', async () => {
      const gameId = await h.playingWith('alice', 'bob');
      await writePanel(gameId, { newCharacters: [sheet('A1'), sheet('A2')] });
      await writePanel(gameId, { newCharacters: [sheet('B1'), sheet('B2')] });
      await writePanel(gameId, { newCharacters: [sheet('C1')] });

      await expectStoryError(
        service.submitPanelDraft(
          gameId,
          'bob',
          3,
          draft({ newCharacters: [sheet('D1'), sheet('D2')] }),
        ),
        'TOO_MANY_CHARACTERS',
      );
      await expect(
        service.submitPanelDraft(gameId, 'bob', 3, draft({ newCharacters: [sheet('D1')] })),
      ).resolves.toBeDefined();
    });

    it('rejects more than MAX_CHARACTERS_PER_PANEL in one panel', async () => {
      const gameId = await h.playingWith('alice', 'bob');
      await writePanel(gameId, { newCharacters: [sheet('A1'), sheet('A2')] });
      await expectStoryError(
        service.submitPanelDraft(
          gameId,
          'bob',
          1,
          draft({ characterIds: ['ch-0-0', 'ch-0-1'], newCharacters: [sheet('B1'), sheet('B2')] }),
        ),
        'INVALID_DRAFT',
      );
    });
  });

  describe('confirmPanel', () => {
    it('needs at least one draft', async () => {
      const gameId = await h.playingWith('alice', 'bob');
      await expectStoryError(service.confirmPanel(gameId, 'alice', 0), 'NO_DRAFT');
    });

    it('only the author can confirm', async () => {
      const gameId = await h.playingWith('alice', 'bob');
      await service.submitPanelDraft(gameId, 'alice', 0, draft());
      await expectStoryError(service.confirmPanel(gameId, 'bob', 0), 'NOT_YOUR_TURN');
    });

    it('closes the panel, replaces its timer and opens the next turn', async () => {
      const gameId = await h.playingWith('alice', 'bob');
      h.clock.now = T0 + 10_000;
      await writePanel(gameId);

      const panel = await panelOf(gameId, 0);
      expect(panel).toMatchObject({
        status: 'closed',
        confirmedBy: 'player',
        originalText: TEXT,
        finalText: TEXT,
      });
      expect(confirmed()).toHaveLength(1);
      expect(h.cancelled('close-turn')).toEqual([
        ['story.cancel', { gameId, kind: 'close-turn', seq: 0, dueAt: T0 + TURN_MS }],
      ]);
      expect(h.scheduled('close-turn').at(-1)).toEqual([
        'story.schedule',
        { gameId, kind: 'close-turn', seq: 1, dueAt: T0 + 10_000 + TURN_MS },
      ]);
    });

    it('uses the corrected text of the last review as the final text', async () => {
      h.reviewer.review.mockResolvedValue({
        correctedText: 'The little robot walks slowly into the dark forest tonight.',
        corrections: [
          { original: 'walked', suggestion: 'walks', type: 'grammar', explanation: 'Presente.' },
        ],
        characterCorrections: [],
        flagged: false,
      });
      const gameId = await h.playingWith('alice', 'bob');
      await writePanel(gameId);

      expect(await panelOf(gameId, 0)).toMatchObject({
        originalText: TEXT,
        finalText: 'The little robot walks slowly into the dark forest tonight.',
      });
    });

    it('moves to PROCESSING after the last panel', async () => {
      const gameId = await h.lobbyWith('alice', 'bob');
      await service.updateConfig(gameId, 'alice', { panelsCount: 4 });
      await service.startStory(gameId, 'alice');
      for (let i = 0; i < 4; i++) await writePanel(gameId);

      const game = await h.gameOf(gameId);
      expect(game).toMatchObject({ status: StoryStatus.PROCESSING, currentPanel: null });
      expect(h.emitted(STORY_EVENTS.processingStarted)).toEqual([{ gameId }]);
      expect(turnsStarted()).toHaveLength(4);
      expect(h.cancelled('close-turn')).toHaveLength(4);
    });
  });

  describe('timeout', () => {
    it('confirms the last reviewed draft, with its new characters', async () => {
      const gameId = await h.playingWith('alice', 'bob');
      await service.submitPanelDraft(gameId, 'alice', 0, draft({ scene: 'First' }));
      await service.submitPanelDraft(
        gameId,
        'alice',
        0,
        draft({ scene: 'Second', newCharacters: [sheet('Beep')] }),
      );

      h.clock.now = T0 + TURN_MS;
      await service.closeTurnByTimeout(gameId, 0, T0 + TURN_MS);

      expect(await panelOf(gameId, 0)).toMatchObject({
        status: 'closed',
        confirmedBy: 'timeout',
        scene: 'Second',
        characterIds: ['ch-0-0'],
      });
      expect(Object.keys((await h.snapshotOf(gameId)).characters)).toEqual(['ch-0-0']);
      expect(turnsStarted().at(-1)).toMatchObject({ panelOrder: 1, authorId: 'bob' });
    });

    it('fills a panel without drafts with the out-of-time text and 0 points', async () => {
      const gameId = await h.playingWith('alice', 'bob');
      h.clock.now = T0 + TURN_MS;
      await service.closeTurnByTimeout(gameId, 0, T0 + TURN_MS);

      expect(confirmed()[0]).toMatchObject({
        finalText: OUT_OF_TIME_TEXT,
        confirmedBy: 'timeout',
        score: { total: 0 },
      });
      expect((await h.gameOf(gameId)).currentPanel).toBe(1);
    });

    it('ignores a job for another panel or another turn deadline', async () => {
      const gameId = await h.playingWith('alice', 'bob');
      await service.closeTurnByTimeout(gameId, 1, T0 + TURN_MS);
      await service.closeTurnByTimeout(gameId, 0, T0 + TURN_MS - 1);
      expect(confirmed()).toHaveLength(0);
    });

    it('drops a review that finishes after the turn closed', async () => {
      const gameId = await h.playingWith('alice', 'bob');
      await service.submitPanelDraft(gameId, 'alice', 0, draft({ scene: 'Reviewed' }));
      const late = deferred<LanguageReview | null>();
      h.reviewer.review.mockReturnValueOnce(late.promise);
      const lateSubmit = service.submitPanelDraft(gameId, 'alice', 0, draft({ scene: 'Late' }));
      await new Promise((resolve) => setImmediate(resolve));

      h.clock.now = T0 + TURN_MS;
      await service.closeTurnByTimeout(gameId, 0, T0 + TURN_MS);
      late.resolve(null);

      await expectStoryError(lateSubmit, 'TURN_CLOSED');
      expect(await panelOf(gameId, 0)).toMatchObject({ scene: 'Reviewed', confirmedBy: 'timeout' });
    });

    it('closes the turn exactly once when confirm and timeout race', async () => {
      const gameId = await h.playingWith('alice', 'bob');
      await service.submitPanelDraft(gameId, 'alice', 0, draft());
      h.clock.now = T0 + TURN_MS;

      const results = await Promise.allSettled([
        service.confirmPanel(gameId, 'alice', 0),
        service.closeTurnByTimeout(gameId, 0, T0 + TURN_MS),
        service.confirmPanel(gameId, 'alice', 0),
      ]);

      expect(confirmed()).toHaveLength(1);
      expect(turnsStarted().map((turn) => turn.panelOrder)).toEqual([0, 1]);
      expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1);
    });

    it('closes the turn exactly once even if the lock was lost (Redis guard)', async () => {
      const gameId = await h.playingWith('alice', 'bob');
      await service.submitPanelDraft(gameId, 'alice', 0, draft());
      h.clock.now = T0 + TURN_MS;
      store.serialize = false;

      const [confirm, timeout] = await Promise.allSettled([
        service.confirmPanel(gameId, 'alice', 0),
        service.closeTurnByTimeout(gameId, 0, T0 + TURN_MS),
      ]);

      expect(confirmed()).toHaveLength(1);
      expect(confirm.status).toBe('fulfilled');
      // El timeout que pierde la carrera no falla: la guarda lo vuelve un no-op.
      expect(timeout.status).toBe('fulfilled');
      expect((await panelOf(gameId, 0)).confirmedBy).toBe('player');
    });
  });

  describe('disconnects and players leaving', () => {
    it('keeps the turn running when the author disconnects, and restores it on resume', async () => {
      const gameId = await h.playingWith('alice', 'bob');
      await service.submitPanelDraft(gameId, 'alice', 0, draft());
      await service.disconnect(gameId, 'alice');

      expect((await panelOf(gameId, 0)).authorId).toBe('alice');
      await service.resume('alice');
      const state = await service.getGameState('alice');
      expect(state.turn).toEqual({ panelOrder: 0, authorId: 'alice', endsAt: T0 + TURN_MS });
      expect(state.myTurn).toMatchObject({ attempts: 1, attemptsLeft: 1, reviewing: false });
      expect(state.myTurn!.drafts).toHaveLength(1);
    });

    it('only shows the own turn details to the author', async () => {
      const gameId = await h.playingWith('alice', 'bob');
      await service.submitPanelDraft(gameId, 'alice', 0, draft());
      const state = await service.getGameState('bob');
      expect(state.myTurn).toBeNull();
      expect(state.turn?.authorId).toBe('alice');
    });

    it('reassigns the panel right away when its author leaves', async () => {
      const gameId = await h.playingWith('alice', 'bob', 'carol');
      await service.submitPanelDraft(gameId, 'alice', 0, draft());
      h.clock.now = T0 + 20_000;
      await service.leaveGame(gameId, 'alice');

      const panel = await panelOf(gameId, 0);
      expect(panel).toMatchObject({ authorId: 'bob', status: 'open', drafts: [], attempts: 0 });
      expect(turnsStarted().at(-1)).toMatchObject({
        panelOrder: 0,
        authorId: 'bob',
        endsAt: T0 + 20_000 + TURN_MS,
      });
      expect(h.cancelled('close-turn')).toHaveLength(1);
    });

    it('skips disconnected players when reassigning', async () => {
      const gameId = await h.playingWith('alice', 'bob', 'carol');
      await service.disconnect(gameId, 'bob');
      await service.leaveGame(gameId, 'alice');
      expect((await panelOf(gameId, 0)).authorId).toBe('carol');
    });

    it('gives the future panels of a player who left to the next one', async () => {
      const gameId = await h.playingWith('alice', 'bob', 'carol');
      await service.leaveGame(gameId, 'bob');
      await writePanel(gameId);
      expect(turnsStarted().at(-1)).toMatchObject({ panelOrder: 1, authorId: 'carol' });
    });

    it('ends the game with the confirmed panels when fewer than 2 players remain', async () => {
      const gameId = await h.playingWith('alice', 'bob');
      await writePanel(gameId);
      await service.leaveGame(gameId, 'bob');

      const snapshot = await h.snapshotOf(gameId);
      expect(snapshot.game.status).toBe(StoryStatus.PROCESSING);
      expect(Object.keys(snapshot.panels)).toEqual(['0']);
      expect(h.emitted(STORY_EVENTS.processingStarted)).toEqual([{ gameId }]);
    });

    it('abandons instead when nothing was confirmed yet', async () => {
      const gameId = await h.playingWith('alice', 'bob');
      await service.leaveGame(gameId, 'bob');
      expect((await h.gameOf(gameId)).status).toBe(StoryStatus.ABANDONED);
    });

    it('counts disconnected players as remaining (they can come back)', async () => {
      const gameId = await h.playingWith('alice', 'bob', 'carol');
      await service.disconnect(gameId, 'bob');
      await service.leaveGame(gameId, 'carol');
      expect((await h.gameOf(gameId)).status).toBe(StoryStatus.PLAYING);
    });
  });
});
