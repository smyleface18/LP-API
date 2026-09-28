import { Story, StoryPanel, StoryParticipant } from '@/db/entities';
import { DraftInput, StorySnapshot } from '@/modules/story-game/domain/story-game.types';
import { STORY_EVENTS, StoryFinishedEvent } from '@/modules/story-game/domain/story-game.events';
import { createStoryHarness } from '../../../test/story-game/story-harness';
import { toHistoryItem, toStoryManifest, toStoryRecords } from './story-history.mapper';

const TEXT = 'The little robot walked slowly into the dark forest tonight.';
const draft = (overrides: Partial<DraftInput> = {}): DraftInput => ({
  text: TEXT,
  scene: 'A dark forest at night',
  characterIds: [],
  newCharacters: [],
  ...overrides,
});

/**
 * Partida jugada de verdad (harness): alice y bob, 4 viñetas. alice escribe la
 * 0 y la 2; bob la 1 y la 3, que vence sin texto (0 puntos).
 */
async function finishedStory(): Promise<StorySnapshot> {
  const h = createStoryHarness(1_800_000_000_000);
  const { service } = h;
  const gameId = await h.lobbyWith('alice', 'bob');
  await service.updateConfig(gameId, 'alice', { panelsCount: 4 });
  await service.startStory(gameId, 'alice');
  for (const [order, author] of ['alice', 'bob', 'alice'].entries()) {
    await service.submitPanelDraft(
      gameId,
      author,
      order,
      draft(
        order === 0
          ? { newCharacters: [{ name: 'Beep', kind: 'robot', description: 'tiny robot' }] }
          : { characterIds: ['ch-0-0'] },
      ),
    );
    await service.confirmPanel(gameId, author, order);
  }
  const { turnCloseAt } = await h.gameOf(gameId);
  h.clock.now = turnCloseAt!;
  await service.closeTurnByTimeout(gameId, 3, turnCloseAt!);
  await service.onProcessingStarted({ gameId });
  await h.completeMedia((order) => ({
    status: order === 1 ? 'failed' : 'ready',
    audioKey: order === 1 ? null : `story/s/panel-${order}.mp3`,
    imageKey: order === 0 ? 'story/s/panel-0.png' : null,
    speechMarks: order === 1 ? null : [{ time: 0, start: 0, end: 3, value: 'The' }],
  }));
  await service.reactToPanel(gameId, 'bob', 0, '🔥');

  const [{ snapshot }] = h.emitted<StoryFinishedEvent>(STORY_EVENTS.finished);
  jest.restoreAllMocks();
  return snapshot;
}

describe('story history mapper', () => {
  let snapshot: StorySnapshot;
  beforeAll(async () => {
    snapshot = await finishedStory();
  });

  it('turns a finished game into a story, its panels and its participants', () => {
    const finishedAt = new Date('2026-09-27T12:00:00Z');
    const { story, panels, participants } = toStoryRecords(snapshot, finishedAt);

    expect(story).toEqual({
      id: snapshot.game.storyId,
      gameId: snapshot.game.gameId,
      title: 'The Robot Adventure',
      level: 'A2',
      language: 'en-US',
      panelsCount: 4,
      characters: [expect.objectContaining({ id: 'ch-0-0', name: 'Beep' })],
      finishedAt,
    });
    expect(panels.map((panel) => [panel.order, panel.mediaStatus])).toEqual([
      [0, 'ready'],
      [1, 'failed'],
      [2, 'ready'],
      [3, 'none'],
    ]);
    expect(panels[0]).toMatchObject({
      storyId: story.id,
      authorId: 'alice',
      authorName: 'name-alice',
      finalText: TEXT,
      audioKey: 'story/s/panel-0.mp3',
      imageKey: 'story/s/panel-0.png',
      reactions: {},
    });
    expect(participants).toEqual([
      expect.objectContaining({ userId: 'alice', position: 1, panelsWritten: 2, left: false }),
      expect.objectContaining({ userId: 'bob', position: 2, panelsWritten: 2, averageScore: 75 }),
    ]);
  });

  it('serves a stored story with the same shape as the live review', () => {
    const records = toStoryRecords(snapshot, new Date('2026-09-27T12:00:00Z'));
    const story = {
      ...records.story,
      panels: records.panels as StoryPanel[],
      participants: records.participants as StoryParticipant[],
    } as Story;

    const manifest = toStoryManifest(
      story,
      { bob: 'https://signed/bob' },
      {
        0: { audioUrl: 'https://signed/0.mp3', imageUrl: 'https://signed/0.png' },
      },
    );
    expect(manifest.storyId).toBe(snapshot.game.storyId);
    expect(manifest.ranking.map((entry) => [entry.userId, entry.avatarUrl])).toEqual([
      ['alice', null],
      ['bob', 'https://signed/bob'],
    ]);
    expect(manifest.panels[0]).toMatchObject({
      author: { id: 'alice', name: 'name-alice' },
      audioUrl: 'https://signed/0.mp3',
      imageUrl: 'https://signed/0.png',
      mediaStatus: 'ready',
      speechMarks: [{ time: 0, start: 0, end: 3, value: 'The' }],
    });
    expect(manifest.panels[1]).toMatchObject({ mediaStatus: 'failed', audioUrl: null });

    const item = toHistoryItem(story, 'alice', {}, 'https://signed/cover.png');
    expect(item).toMatchObject({
      storyId: story.id,
      finishedAt: '2026-09-27T12:00:00.000Z',
      panelsCount: 4,
      excerpt: TEXT,
      coverImageUrl: 'https://signed/cover.png',
      myPosition: 1,
      myScore: records.participants[0].totalScore,
    });
    expect(item.players.map((player) => player.userId)).toEqual(['alice', 'bob']);
  });
});
