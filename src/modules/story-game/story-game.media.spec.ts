import { StoryGameService } from './story-game.service';
import {
  MediaRequestedEvent,
  PanelMediaReadyEvent,
  ProcessingStartedEvent,
  STORY_EVENTS,
  StoryFinishedEvent,
  StoryProcessingEvent,
  StoryStateChangedEvent,
} from './domain/story-game.events';
import { DraftInput, PanelMedia, StoryStatus } from './domain/story-game.types';
import { MEDIA_DEADLINE_MS } from './story-game.config';
import { createStoryHarness } from '../../../test/story-game/story-harness';

/** 10 palabras. */
const TEXT = 'The little robot walked slowly into the dark forest tonight.';
const draft = (overrides: Partial<DraftInput> = {}): DraftInput => ({
  text: TEXT,
  scene: 'A dark forest at night',
  characterIds: [],
  newCharacters: [],
  ...overrides,
});

const ready = (order: number): PanelMedia => ({
  status: 'ready',
  audioKey: `story/s/panel-${order}.mp3`,
  imageKey: `story/s/panel-${order}.png`,
  speechMarks: [{ time: 0, start: 0, end: 3, value: 'The' }],
});
const FAILED: PanelMedia = {
  status: 'failed',
  audioKey: null,
  imageKey: null,
  imageStatus: 'failed',
  speechMarks: null,
};

describe('StoryGameService — story media (phase 4b)', () => {
  const T0 = 1_800_000_000_000;
  let h: ReturnType<typeof createStoryHarness>;
  let service: StoryGameService;

  beforeEach(() => {
    h = createStoryHarness(T0);
    ({ service } = h);
  });

  afterEach(() => jest.restoreAllMocks());

  const statuses = () =>
    h
      .emitted<StoryStateChangedEvent>(STORY_EVENTS.stateChanged)
      .map(({ snapshot }) => snapshot.game.status);
  const mediaRequested = () => h.emitted<MediaRequestedEvent>(STORY_EVENTS.mediaRequested);
  const status = async (gameId: string) => (await h.gameOf(gameId)).status;

  /** El autor del turno en curso escribe y confirma. */
  async function writePanel(gameId: string, input: Partial<DraftInput> = {}) {
    const { currentPanel } = await h.gameOf(gameId);
    const { authorId } = (await h.snapshotOf(gameId)).panels[currentPanel!];
    await service.submitPanelDraft(gameId, authorId, currentPanel!, draft(input));
    await service.confirmPanel(gameId, authorId, currentPanel!);
  }

  /**
   * alice y bob, 4 viñetas: 0, 1 y 2 con texto (la 0 crea a Beep y la 1 lo
   * usa); la 3 vence sin texto. Termina en PROCESSING con la media pedida.
   */
  async function storyInProcessing() {
    const gameId = await h.lobbyWith('alice', 'bob');
    await service.updateConfig(gameId, 'alice', { panelsCount: 4 });
    await service.startStory(gameId, 'alice');
    await writePanel(gameId, {
      newCharacters: [{ name: 'Beep', kind: 'robot', description: 'tiny silver robot' }],
    });
    await writePanel(gameId, { characterIds: ['ch-0-0'], scene: 'A cave' });
    await writePanel(gameId);
    const { turnCloseAt } = await h.gameOf(gameId);
    h.clock.now = turnCloseAt!;
    await service.closeTurnByTimeout(gameId, 3, turnCloseAt!);

    for (const event of h.emitted<ProcessingStartedEvent>(STORY_EVENTS.processingStarted)) {
      await service.onProcessingStarted(event);
    }
    return gameId;
  }

  it('asks for the media of every panel with text, with its cast', async () => {
    const gameId = await storyInProcessing();
    const { storyId, mediaDeadlineAt } = await h.gameOf(gameId);

    expect(storyId).toMatch(/^[0-9a-f-]{36}$/);
    expect(mediaDeadlineAt).toBe(h.clock.now + MEDIA_DEADLINE_MS);
    expect(mediaRequested()).toHaveLength(1);
    const [{ panels }] = mediaRequested();
    expect(panels.map((panel) => panel.order)).toEqual([0, 1, 2]);
    expect(panels[1]).toEqual({
      gameId,
      storyId,
      order: 1,
      text: TEXT,
      scene: 'A cave',
      characters: [{ name: 'Beep', kind: 'robot', description: 'tiny silver robot' }],
      languageCode: 'en-US',
    });

    const { panels: stored } = await h.snapshotOf(gameId);
    expect([0, 1, 2, 3].map((order) => stored[order].media?.status)).toEqual([
      'pending',
      'pending',
      'pending',
      'none',
    ]);
    expect(h.emitted<StoryProcessingEvent>(STORY_EVENTS.processing)).toEqual([
      { gameId, panelsTotal: 3, panelsDone: 0 },
    ]);
    expect(h.scheduled('media-deadline')).toHaveLength(1);
  });

  it('asks for the media only once', async () => {
    const gameId = await storyInProcessing();
    const { storyId } = await h.gameOf(gameId);
    await service.onProcessingStarted({ gameId });

    expect(mediaRequested()).toHaveLength(1);
    expect((await h.gameOf(gameId)).storyId).toBe(storyId);
  });

  it('stays in PROCESSING until the first panel has its media', async () => {
    const gameId = await storyInProcessing();
    await service.onPanelMedia(gameId, 2, ready(2));
    await service.onPanelMedia(gameId, 1, ready(1));

    expect(await status(gameId)).toBe(StoryStatus.PROCESSING);
    expect(h.emitted<StoryProcessingEvent>(STORY_EVENTS.processing).at(-1)).toEqual({
      gameId,
      panelsTotal: 3,
      panelsDone: 2,
    });

    await service.onPanelMedia(gameId, 0, ready(0));
    // La última pendiente era la primera: pasa por REVIEW y termina.
    expect(statuses().slice(-2)).toEqual([StoryStatus.REVIEW, StoryStatus.FINISHED]);
  });

  it('enters REVIEW with the first panel and FINISHES with the last one', async () => {
    const gameId = await storyInProcessing();
    await service.onPanelMedia(gameId, 0, ready(0));
    expect(await status(gameId)).toBe(StoryStatus.REVIEW);

    await service.onPanelMedia(gameId, 1, FAILED);
    expect(await status(gameId)).toBe(StoryStatus.REVIEW);

    await service.onPanelMedia(gameId, 2, ready(2));
    expect(await status(gameId)).toBe(StoryStatus.FINISHED);
    expect((await h.gameOf(gameId)).mediaDeadlineAt).toBeNull();
    expect(h.cancelled('media-deadline')).toHaveLength(1);

    const [{ snapshot }] = h.emitted<StoryFinishedEvent>(STORY_EVENTS.finished);
    expect(snapshot.panels[0].media).toEqual(ready(0));
    expect(snapshot.panels[1].media).toEqual(FAILED);
    expect(
      h.emitted<PanelMediaReadyEvent>(STORY_EVENTS.panelMediaReady).map(({ order }) => order),
    ).toEqual([0, 1, 2]);
  });

  it('puts the media in the manifest, signed', async () => {
    h.urls.mediaFor.mockResolvedValue({
      0: { audioUrl: 'https://signed/0.mp3', imageUrl: 'https://signed/0.png' },
    });
    const gameId = await storyInProcessing();
    await service.onPanelMedia(gameId, 0, ready(0));

    const manifest = await service.getReviewManifest(gameId, 'alice');
    expect(manifest.panels[0]).toMatchObject({
      mediaStatus: 'ready',
      audioUrl: 'https://signed/0.mp3',
      imageUrl: 'https://signed/0.png',
      speechMarks: ready(0).speechMarks,
    });
    expect(manifest.panels[1]).toMatchObject({ mediaStatus: 'pending', audioUrl: null });
  });

  it('ignores a result for a panel that is no longer pending', async () => {
    const gameId = await storyInProcessing();
    await service.onPanelMedia(gameId, 0, FAILED);
    await service.onPanelMedia(gameId, 0, ready(0));

    expect((await h.snapshotOf(gameId)).panels[0].media).toEqual(FAILED);
  });

  it('fails whatever is still pending when the deadline expires', async () => {
    const gameId = await storyInProcessing();
    await service.onPanelMedia(gameId, 0, ready(0));
    const { mediaDeadlineAt } = await h.gameOf(gameId);

    // Una tarea vieja (otro dueAt) no hace nada.
    await service.expireMedia(gameId, mediaDeadlineAt! - 1);
    expect(await status(gameId)).toBe(StoryStatus.REVIEW);

    h.clock.now = mediaDeadlineAt!;
    await service.expireMedia(gameId, mediaDeadlineAt!);
    const { panels } = await h.snapshotOf(gameId);
    expect(panels[1].media).toEqual(FAILED);
    expect(panels[2].media).toEqual(FAILED);
    expect(await status(gameId)).toBe(StoryStatus.FINISHED);

    // Lo que llegue tarde se descarta.
    await service.onPanelMedia(gameId, 1, ready(1));
    expect((await h.snapshotOf(gameId)).panels[1].media).toEqual(FAILED);
  });

  it('also leaves PROCESSING when the deadline expires before the first panel', async () => {
    const gameId = await storyInProcessing();
    const { mediaDeadlineAt } = await h.gameOf(gameId);
    h.clock.now = mediaDeadlineAt!;
    await service.expireMedia(gameId, mediaDeadlineAt!);

    expect(statuses().slice(-2)).toEqual([StoryStatus.REVIEW, StoryStatus.FINISHED]);
  });

  it('goes straight to FINISHED when no panel has text', async () => {
    const gameId = await h.lobbyWith('alice', 'bob');
    await service.updateConfig(gameId, 'alice', { panelsCount: 4 });
    await service.startStory(gameId, 'alice');
    await writePanel(gameId);
    await service.leaveGame(gameId, 'bob');
    // Solo la viñeta 0, con texto: se prueba el caso sin texto marcándola vacía.
    await h.store.patch(gameId, (snapshot) => {
      snapshot.panels[0].originalText = '';
    });

    for (const event of h.emitted<ProcessingStartedEvent>(STORY_EVENTS.processingStarted)) {
      await service.onProcessingStarted(event);
    }
    expect(mediaRequested()).toEqual([]);
    expect(await status(gameId)).toBe(StoryStatus.FINISHED);
    expect((await h.gameOf(gameId)).mediaDeadlineAt).toBeNull();
  });
});
