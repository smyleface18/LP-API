import { Job, Queue } from 'bullmq';
import { StoryMediaService } from '@/modules/story-media/story-media.service';
import { StoryGameService } from '../story-game.service';
import { PanelMediaRequestEvent } from '../domain/story-game.events';
import { StoryMediaQueue } from './story-media.queue';
import { StoryMediaProcessor } from './story-media.processor';

const panel = (order: number): PanelMediaRequestEvent => ({
  gameId: 'g1',
  storyId: 's1',
  order,
  text: 'Max walked home.',
  scene: 'A street',
  characters: [],
  languageCode: 'en-US',
});

describe('StoryMediaQueue', () => {
  it('queues one job per panel, in order, with a fixed id', async () => {
    const queue = { addBulk: jest.fn().mockResolvedValue([]) };
    await new StoryMediaQueue(queue as unknown as Queue).enqueue({
      gameId: 'g1',
      panels: [panel(0), panel(1)],
    });

    const [jobs] = queue.addBulk.mock.calls[0] as [{ data: unknown; opts: { jobId: string } }[]];
    expect(jobs.map((job) => job.opts.jobId)).toEqual(['g1__media__0', 'g1__media__1']);
    expect(jobs[0].data).toEqual(panel(0));
  });

  it('does not throw when Redis is down (the deadline finishes the story)', async () => {
    const queue = { addBulk: jest.fn().mockRejectedValue(new Error('ECONNREFUSED')) };
    await expect(
      new StoryMediaQueue(queue as unknown as Queue).enqueue({ gameId: 'g1', panels: [panel(0)] }),
    ).resolves.toBeUndefined();
  });
});

describe('StoryMediaProcessor', () => {
  it('generates the media of the panel and hands the result to the game', async () => {
    const result = { status: 'ready', audioKey: 'a.mp3', imageKey: null, speechMarks: [] };
    const media = { generatePanel: jest.fn().mockResolvedValue(result) };
    const game = { onPanelMedia: jest.fn().mockResolvedValue(undefined) };
    const processor = new StoryMediaProcessor(
      media as unknown as StoryMediaService,
      game as unknown as StoryGameService,
    );

    await processor.process({ data: panel(2) } as Job<PanelMediaRequestEvent>);

    expect(media.generatePanel).toHaveBeenCalledWith(panel(2));
    expect(game.onPanelMedia).toHaveBeenCalledWith('g1', 2, result);
  });
});
