import { Correction } from '@/modules/language-review/language-review.types';
import { StoryGameService } from './story-game.service';
import {
  AuthorStatusEvent,
  DraftReviewedEvent,
  PanelReactionEvent,
  STORY_EVENTS,
} from './domain/story-game.events';
import { DraftInput, StoryStatus } from './domain/story-game.types';
import { REVIEW_STALE_MS } from './story-game.config';
import { createStoryHarness, expectStoryError } from '../../../test/story-game/story-harness';

const TEXT = 'The little robot walk slowly into the dark forest tonight.';
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
  newCharacters: [{ name: 'Beep', kind: 'robot', description: 'small silver robot' }],
  ...overrides,
});

/** Promesa que el test resuelve cuando quiere (para dejar una revisión "en curso"). */
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

describe('StoryGameService — author status, shared drafts and reactions', () => {
  const T0 = 1_800_000_000_000;
  let h: ReturnType<typeof createStoryHarness>;
  let service: StoryGameService;

  beforeEach(() => {
    h = createStoryHarness(T0);
    ({ service } = h);
    h.reviewer.review.mockImplementation((input) =>
      Promise.resolve({
        correctedText: input.text.replace('walk ', 'walked '),
        corrections: [CORRECTION],
        characterCorrections: [],
        flagged: false,
      }),
    );
  });

  afterEach(() => jest.restoreAllMocks());

  const statuses = () => h.emitted<AuthorStatusEvent>(STORY_EVENTS.authorStatus);
  const shared = () => h.emitted<DraftReviewedEvent>(STORY_EVENTS.draftReviewed);
  const reactions = () => h.emitted<PanelReactionEvent>(STORY_EVENTS.panelReaction);

  describe('authorStatus', () => {
    it('goes reviewing while the AI works and correcting once the draft is back', async () => {
      const gameId = await h.playingWith('alice', 'bob');
      const review = deferred<Awaited<ReturnType<typeof h.reviewer.review>>>();
      h.reviewer.review.mockReturnValueOnce(review.promise);

      const submit = service.submitPanelDraft(gameId, 'alice', 0, draft());
      await new Promise(setImmediate);
      expect(statuses()).toEqual([{ gameId, order: 0, status: 'reviewing' }]);
      expect((await service.getGameState('bob')).turn?.authorStatus).toBe('reviewing');

      review.resolve({
        correctedText: TEXT,
        corrections: [],
        characterCorrections: [],
        flagged: false,
      });
      await submit;
      expect(statuses().at(-1)).toEqual({ gameId, order: 0, status: 'correcting' });
      expect((await service.getGameState('bob')).turn?.authorStatus).toBe('correcting');
    });

    it('goes back to writing after a flagged first draft', async () => {
      const gameId = await h.playingWith('alice', 'bob');
      h.reviewer.review.mockResolvedValueOnce({
        correctedText: '',
        corrections: [],
        characterCorrections: [],
        flagged: true,
      });
      await service.submitPanelDraft(gameId, 'alice', 0, draft());
      expect(statuses().map((event) => event.status)).toEqual(['reviewing', 'writing']);
    });

    it('is writing at the start of a turn and ignores a stale review', async () => {
      const gameId = await h.playingWith('alice', 'bob');
      expect((await service.getGameState('bob')).turn?.authorStatus).toBe('writing');

      await h.store.patch(gameId, (snapshot) => {
        snapshot.panels[0].reviewing = { attemptId: 'lost', startedAt: T0 };
      });
      h.clock.now = T0 + REVIEW_STALE_MS;
      expect((await service.getGameState('bob')).turn?.authorStatus).toBe('writing');
    });
  });

  describe('panelDraftReviewed (shareDrafts)', () => {
    it('shares each reviewed draft with its corrections but never the corrected text', async () => {
      const gameId = await h.playingWith('alice', 'bob');
      await service.submitPanelDraft(gameId, 'alice', 0, draft());

      expect(shared()).toEqual([
        {
          gameId,
          order: 0,
          authorId: 'alice',
          text: TEXT,
          scene: 'A dark forest at night',
          characterIds: [],
          newCharacters: [{ name: 'Beep', kind: 'robot', description: 'small silver robot' }],
          reviewAvailable: true,
          corrections: [CORRECTION],
          characterCorrections: [],
        },
      ]);
      expect(JSON.stringify(shared())).not.toContain('walked slowly');
    });

    it('shares a draft the AI could not review, without corrections', async () => {
      const gameId = await h.playingWith('alice', 'bob');
      h.reviewer.review.mockRejectedValueOnce(new Error('bedrock down'));
      await service.submitPanelDraft(gameId, 'alice', 0, draft());
      expect(shared()[0]).toMatchObject({ reviewAvailable: false, corrections: [] });
    });

    it('does not share a flagged draft', async () => {
      const gameId = await h.playingWith('alice', 'bob');
      h.reviewer.review.mockResolvedValueOnce({
        correctedText: '',
        corrections: [],
        characterCorrections: [],
        flagged: true,
      });
      await service.submitPanelDraft(gameId, 'alice', 0, draft());
      expect(shared()).toEqual([]);
    });

    it('does not share anything when the host turned shareDrafts off', async () => {
      const gameId = await h.lobbyWith('alice', 'bob');
      await service.updateConfig(gameId, 'alice', { shareDrafts: false });
      await service.startStory(gameId, 'alice');
      await service.submitPanelDraft(gameId, 'alice', 0, draft());
      expect(shared()).toEqual([]);
    });
  });

  describe('reactToPanel', () => {
    async function withConfirmedPanel() {
      const gameId = await h.playingWith('alice', 'bob', 'carol');
      await service.submitPanelDraft(gameId, 'alice', 0, draft());
      await service.confirmPanel(gameId, 'alice', 0);
      return gameId;
    }

    it('stores one reaction per player and broadcasts it', async () => {
      const gameId = await withConfirmedPanel();
      await service.reactToPanel(gameId, 'bob', 0, '😂');
      await service.reactToPanel(gameId, 'carol', 0, '👏');
      await service.reactToPanel(gameId, 'bob', 0, '🔥');

      expect((await h.snapshotOf(gameId)).panels[0].reactions).toEqual({
        bob: '🔥',
        carol: '👏',
      });
      expect(reactions()).toEqual([
        { gameId, order: 0, userId: 'bob', emoji: '😂' },
        { gameId, order: 0, userId: 'carol', emoji: '👏' },
        { gameId, order: 0, userId: 'bob', emoji: '🔥' },
      ]);
    });

    it('removes a reaction with null and ignores repeats', async () => {
      const gameId = await withConfirmedPanel();
      await service.reactToPanel(gameId, 'bob', 0, '😂');
      await service.reactToPanel(gameId, 'bob', 0, '😂');
      await service.reactToPanel(gameId, 'bob', 0, null);
      await service.reactToPanel(gameId, 'bob', 0, null);

      expect((await h.snapshotOf(gameId)).panels[0].reactions).toEqual({});
      expect(reactions().map((event) => event.emoji)).toEqual(['😂', null]);
    });

    it('shows the reactions in the story so far', async () => {
      const gameId = await withConfirmedPanel();
      await service.reactToPanel(gameId, 'carol', 0, '❤️');
      const state = await service.getGameState('bob');
      expect(state.storySoFar[0].reactions).toEqual({ carol: '❤️' });
    });

    it('only accepts confirmed panels', async () => {
      const gameId = await withConfirmedPanel();
      await expectStoryError(service.reactToPanel(gameId, 'alice', 1, '😂'), 'PANEL_NOT_CONFIRMED');
      await expectStoryError(service.reactToPanel(gameId, 'alice', 5, '😂'), 'PANEL_NOT_CONFIRMED');
    });

    it('rejects outsiders and players who left', async () => {
      const gameId = await withConfirmedPanel();
      await expectStoryError(service.reactToPanel(gameId, 'mallory', 0, '😂'), 'NOT_A_PLAYER');
      await service.leaveGame(gameId, 'carol');
      await expectStoryError(service.reactToPanel(gameId, 'carol', 0, '😂'), 'NOT_A_PLAYER');
    });

    it('is not available in the lobby or in an abandoned game', async () => {
      const gameId = await h.lobbyWith('alice', 'bob');
      await expectStoryError(service.reactToPanel(gameId, 'bob', 0, '😂'), 'INVALID_STATE');
      await h.store.patch(gameId, (snapshot) => {
        snapshot.game.status = StoryStatus.ABANDONED;
      });
      await expectStoryError(service.reactToPanel(gameId, 'bob', 0, '😂'), 'INVALID_STATE');
    });
  });
});
