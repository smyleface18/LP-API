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
import {
  DraftInput,
  PanelAudioResult,
  PanelImageResult,
  StorySnapshot,
  StoryStatus,
} from './domain/story-game.types';
import { MEDIA_DEADLINE_MS, REVIEW_MAX_WAIT_MS } from './story-game.config';
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

const audio = (order: number): PanelAudioResult => ({
  status: 'ready',
  audioKey: `story/s/panel-${order}.mp3`,
  speechMarks: [{ time: 0, start: 0, end: 3, value: 'The' }],
});
const AUDIO_FAILED: PanelAudioResult = { status: 'failed', audioKey: null, speechMarks: null };
const image = (order: number): PanelImageResult => ({
  imageStatus: 'ready',
  imageKey: `story/s/panel-${order}.jpg`,
});
const IMAGE_FAILED: PanelImageResult = { imageStatus: 'failed', imageKey: null };

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
    expect([0, 1, 2, 3].map((order) => stored[order].media?.imageStatus)).toEqual([
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

  /** Audio e imagen de las viñetas `orders`, en ese orden. */
  async function completeMedia(gameId: string, orders: number[]) {
    for (const order of orders) {
      await service.onPanelAudio(gameId, order, audio(order));
      await service.onPanelImage(gameId, order, image(order));
    }
  }

  const mediaOf = async (gameId: string, order: number) =>
    (await h.snapshotOf(gameId)).panels[order].media;

  /** Corre la tarea `review-wait` en su hora: se terminó la espera de PROCESSING. */
  async function endWait(gameId: string) {
    const { reviewAt } = await h.gameOf(gameId);
    h.clock.now = reviewAt!;
    await service.endReviewWait(gameId, reviewAt!);
  }

  it('waits in PROCESSING until everything is ready, and then shows it all at once', async () => {
    const gameId = await storyInProcessing();
    await completeMedia(gameId, [2, 1]);
    await service.onPanelAudio(gameId, 0, audio(0));

    // La primera viñeta ya tiene audio, pero falta su imagen: sigue esperando.
    expect(await status(gameId)).toBe(StoryStatus.PROCESSING);
    expect(h.emitted<StoryProcessingEvent>(STORY_EVENTS.processing).at(-1)).toEqual({
      gameId,
      panelsTotal: 3,
      panelsDone: 2,
    });

    await service.onPanelImage(gameId, 0, image(0));
    expect(statuses().slice(-2)).toEqual([StoryStatus.REVIEW, StoryStatus.FINISHED]);
    const [{ snapshot }] = h.emitted<{ snapshot: StorySnapshot }>(STORY_EVENTS.reviewReady);
    expect(Object.values(snapshot.panels).map((panel) => panel.media?.imageStatus)).toEqual([
      'ready',
      'ready',
      'ready',
      'none',
    ]);
  });

  it('schedules the end of the wait and cancels it when the review starts', async () => {
    const gameId = await storyInProcessing();
    const { reviewAt } = await h.gameOf(gameId);
    expect(reviewAt).toBe(h.clock.now + REVIEW_MAX_WAIT_MS);
    expect(h.scheduled('review-wait')).toEqual([
      ['story.schedule', { gameId, kind: 'review-wait', seq: 0, dueAt: reviewAt }],
    ]);

    await completeMedia(gameId, [0, 1, 2]);
    expect(h.cancelled('review-wait')).toHaveLength(1);
  });

  it('when the wait ends, starts the review with the first audio and the rest arrives later', async () => {
    const gameId = await storyInProcessing();
    await service.onPanelAudio(gameId, 0, audio(0));
    await endWait(gameId);

    expect(await status(gameId)).toBe(StoryStatus.REVIEW);
    expect(await mediaOf(gameId, 0)).toEqual({
      ...audio(0),
      imageKey: null,
      imageStatus: 'pending',
    });

    await service.onPanelImage(gameId, 0, image(0));
    await completeMedia(gameId, [1, 2]);
    expect(await status(gameId)).toBe(StoryStatus.FINISHED);
  });

  it('after the wait, still needs the audio of the first panel', async () => {
    const gameId = await storyInProcessing();
    await endWait(gameId);
    expect(await status(gameId)).toBe(StoryStatus.PROCESSING);

    await service.onPanelAudio(gameId, 0, audio(0));
    expect(await status(gameId)).toBe(StoryStatus.REVIEW);
  });

  it('ignores an old review-wait job', async () => {
    const gameId = await storyInProcessing();
    await service.onPanelAudio(gameId, 0, audio(0));
    const { reviewAt } = await h.gameOf(gameId);
    await service.endReviewWait(gameId, reviewAt! - 1);

    expect(await status(gameId)).toBe(StoryStatus.PROCESSING);
    expect((await h.gameOf(gameId)).reviewAt).toBe(reviewAt);
  });

  it('sends every change of a panel with panelMediaReady: the audio first, then the image', async () => {
    const gameId = await storyInProcessing();
    await service.onPanelAudio(gameId, 0, audio(0));
    expect(await mediaOf(gameId, 0)).toEqual({
      ...audio(0),
      imageKey: null,
      imageStatus: 'pending',
    });

    await service.onPanelImage(gameId, 0, image(0));
    expect(await mediaOf(gameId, 0)).toMatchObject({ status: 'ready', ...image(0) });

    const updates = h.emitted<PanelMediaReadyEvent>(STORY_EVENTS.panelMediaReady);
    expect(updates.map(({ order, media }) => [order, media.status, media.imageStatus])).toEqual([
      [0, 'ready', 'pending'],
      [0, 'ready', 'ready'],
    ]);
  });

  it('FINISHES once no audio or image is pending', async () => {
    const gameId = await storyInProcessing();
    await completeMedia(gameId, [0]);
    await service.onPanelAudio(gameId, 1, AUDIO_FAILED);
    await service.onPanelImage(gameId, 1, IMAGE_FAILED);
    await service.onPanelAudio(gameId, 2, audio(2));
    expect(await status(gameId)).toBe(StoryStatus.PROCESSING);

    await service.onPanelImage(gameId, 2, { imageStatus: 'none', imageKey: null });
    expect(await status(gameId)).toBe(StoryStatus.FINISHED);
    expect((await h.gameOf(gameId)).mediaDeadlineAt).toBeNull();
    expect(h.cancelled('media-deadline')).toHaveLength(1);

    const [{ snapshot }] = h.emitted<StoryFinishedEvent>(STORY_EVENTS.finished);
    expect(snapshot.panels[0].media).toEqual({ ...audio(0), ...image(0) });
    expect(snapshot.panels[1].media).toEqual({ ...AUDIO_FAILED, ...IMAGE_FAILED });
    expect(snapshot.panels[2].media?.imageStatus).toBe('none');
  });

  it('puts the media in the manifest, signed', async () => {
    h.urls.mediaFor.mockResolvedValue({
      0: { audioUrl: 'https://signed/0.mp3', imageUrl: 'https://signed/0.jpg' },
    });
    const gameId = await storyInProcessing();
    await completeMedia(gameId, [0]);
    await endWait(gameId);

    const manifest = await service.getReviewManifest(gameId, 'alice');
    expect(manifest.panels[0]).toMatchObject({
      mediaStatus: 'ready',
      imageStatus: 'ready',
      audioUrl: 'https://signed/0.mp3',
      imageUrl: 'https://signed/0.jpg',
      speechMarks: audio(0).speechMarks,
    });
    expect(manifest.panels[1]).toMatchObject({
      mediaStatus: 'pending',
      imageStatus: 'pending',
      audioUrl: null,
    });
  });

  it('ignores an audio or an image that is no longer pending', async () => {
    const gameId = await storyInProcessing();
    await service.onPanelAudio(gameId, 0, AUDIO_FAILED);
    await service.onPanelAudio(gameId, 0, audio(0));
    await service.onPanelImage(gameId, 0, IMAGE_FAILED);
    await service.onPanelImage(gameId, 0, image(0));

    expect(await mediaOf(gameId, 0)).toEqual({ ...AUDIO_FAILED, ...IMAGE_FAILED });
  });

  it('skips the images left in the story after a 429, and keeps the ones already drawn', async () => {
    const gameId = await storyInProcessing();
    await completeMedia(gameId, [0]);
    await service.onPanelAudio(gameId, 1, audio(1));
    expect(await service.isImagePending(gameId, 2)).toBe(true);

    await service.onPanelImage(gameId, 1, { ...IMAGE_FAILED, rateLimited: true });

    expect((await mediaOf(gameId, 0))?.imageStatus).toBe('ready');
    expect((await mediaOf(gameId, 1))?.imageStatus).toBe('failed');
    expect(await mediaOf(gameId, 2)).toMatchObject({ status: 'pending', imageStatus: 'failed' });
    expect(await service.isImagePending(gameId, 2)).toBe(false);
    // Falta el audio de la viñeta 2: la historieta sigue esperando.
    expect(await status(gameId)).toBe(StoryStatus.PROCESSING);

    await service.onPanelAudio(gameId, 2, audio(2));
    expect(await status(gameId)).toBe(StoryStatus.FINISHED);
  });

  it('isImagePending is false for a game that no longer exists', async () => {
    expect(await service.isImagePending('missing-game', 0)).toBe(false);
  });

  it('on the deadline, fails what is pending but never an audio already generated', async () => {
    const gameId = await storyInProcessing();
    await completeMedia(gameId, [0]);
    // La viñeta 1 tiene audio pero la imagen sigue pendiente; la 2 no tiene nada.
    await service.onPanelAudio(gameId, 1, audio(1));
    const { mediaDeadlineAt } = await h.gameOf(gameId);

    // Una tarea vieja (otro dueAt) no hace nada.
    await service.expireMedia(gameId, mediaDeadlineAt! - 1);
    expect(await status(gameId)).toBe(StoryStatus.PROCESSING);

    h.clock.now = mediaDeadlineAt!;
    await service.expireMedia(gameId, mediaDeadlineAt!);
    expect(await mediaOf(gameId, 1)).toEqual({ ...audio(1), ...IMAGE_FAILED });
    expect(await mediaOf(gameId, 2)).toEqual({ ...AUDIO_FAILED, ...IMAGE_FAILED });
    expect(await status(gameId)).toBe(StoryStatus.FINISHED);

    // Lo que llegue tarde se descarta.
    await service.onPanelAudio(gameId, 2, audio(2));
    await service.onPanelImage(gameId, 1, image(1));
    expect((await mediaOf(gameId, 2))?.status).toBe('failed');
    expect((await mediaOf(gameId, 1))?.imageStatus).toBe('failed');
  });

  describe('title', () => {
    it('asks the AI for a title with the final text of each panel and the cast', async () => {
      const gameId = await storyInProcessing();

      expect(h.titler.title).toHaveBeenCalledTimes(1);
      expect(h.titler.title).toHaveBeenCalledWith({
        panels: [TEXT, TEXT, TEXT],
        characters: ['Beep'],
      });
      expect(await h.gameOf(gameId)).toMatchObject({
        title: 'The Robot Adventure',
        titlePending: false,
      });

      await completeMedia(gameId, [0, 1, 2]);
      const manifest = await service.getReviewManifest(gameId, 'alice');
      expect(manifest.title).toBe('The Robot Adventure');
      const [{ snapshot }] = h.emitted<StoryFinishedEvent>(STORY_EVENTS.finished);
      expect(snapshot.game.title).toBe('The Robot Adventure');
    });

    it('waits for the title before the review, even with all the media ready', async () => {
      let resolveTitle!: (title: string | null) => void;
      h.titler.title.mockImplementation(
        () => new Promise<string | null>((resolve) => (resolveTitle = resolve)),
      );
      const gameId = await h.lobbyWith('alice', 'bob');
      await service.updateConfig(gameId, 'alice', { panelsCount: 4 });
      await service.startStory(gameId, 'alice');
      for (let i = 0; i < 4; i++) await writePanel(gameId);
      const [started] = h.emitted<ProcessingStartedEvent>(STORY_EVENTS.processingStarted);
      const processing = service.onProcessingStarted(started);
      await new Promise((resolve) => setImmediate(resolve));

      await completeMedia(gameId, [0, 1, 2, 3]);
      expect(await status(gameId)).toBe(StoryStatus.PROCESSING);

      resolveTitle('Four Little Panels');
      await processing;
      expect(await status(gameId)).toBe(StoryStatus.FINISHED);
      expect((await h.gameOf(gameId)).title).toBe('Four Little Panels');
    });

    it('finishes without a title when the AI does not give one', async () => {
      h.titler.title.mockResolvedValue(null);
      const gameId = await storyInProcessing();
      await completeMedia(gameId, [0, 1, 2]);

      expect(await status(gameId)).toBe(StoryStatus.FINISHED);
      expect((await h.gameOf(gameId)).title).toBeNull();
    });

    it('the deadline also stops waiting for a title that never came', async () => {
      h.titler.title.mockReturnValue(new Promise(() => {}));
      const gameId = await h.lobbyWith('alice', 'bob');
      await service.updateConfig(gameId, 'alice', { panelsCount: 4 });
      await service.startStory(gameId, 'alice');
      for (let i = 0; i < 4; i++) await writePanel(gameId);
      const [started] = h.emitted<ProcessingStartedEvent>(STORY_EVENTS.processingStarted);
      void service.onProcessingStarted(started);
      await new Promise((resolve) => setImmediate(resolve));
      await completeMedia(gameId, [0, 1, 2, 3]);
      expect((await h.gameOf(gameId)).titlePending).toBe(true);

      const { mediaDeadlineAt } = await h.gameOf(gameId);
      h.clock.now = mediaDeadlineAt!;
      await service.expireMedia(gameId, mediaDeadlineAt!);
      expect(await status(gameId)).toBe(StoryStatus.FINISHED);
      expect(await h.gameOf(gameId)).toMatchObject({ title: null, titlePending: false });
    });
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
