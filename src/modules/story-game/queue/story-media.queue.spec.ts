import { Job, Queue } from 'bullmq';
import { StoryMediaService } from '@/modules/story-media/story-media.service';
import { StoryGameService } from '../story-game.service';
import { PanelMediaRequestEvent } from '../domain/story-game.events';
import { StoryMediaQueue } from './story-media.queue';
import { StoryMediaProcessor } from './story-media.processor';
import { StoryMediaJobName } from './type';

const panel = (order: number): PanelMediaRequestEvent => ({
  gameId: 'g1',
  storyId: 's1',
  order,
  text: 'Max walked home.',
  scene: 'A street',
  characters: [],
  languageCode: 'en-US',
});

type QueuedJob = { name: string; data: unknown; opts: { jobId: string; priority: number } };

describe('StoryMediaQueue', () => {
  it('queues an audio and an image job per panel, audios first, with fixed ids', async () => {
    const queue = { addBulk: jest.fn().mockResolvedValue([]) };
    await new StoryMediaQueue(queue as unknown as Queue).enqueue({
      gameId: 'g1',
      panels: [panel(0), panel(1)],
    });

    const [jobs] = queue.addBulk.mock.calls[0] as [QueuedJob[]];
    expect(jobs.map((job) => [job.name, job.opts.jobId])).toEqual([
      ['panel-audio', 'g1__audio__0'],
      ['panel-audio', 'g1__audio__1'],
      ['panel-image', 'g1__image__0'],
      ['panel-image', 'g1__image__1'],
    ]);
    // Menor = antes: los audios nunca esperan a una imagen.
    const priority = (name: string) => jobs.find((job) => job.name === name)!.opts.priority;
    expect(priority('panel-audio')).toBeLessThan(priority('panel-image'));
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
  const AUDIO = { status: 'ready', audioKey: 'a.mp3', speechMarks: [] };
  const IMAGE = { imageStatus: 'ready', imageKey: 'i.jpg' };
  let media: { generateAudio: jest.Mock; generateImage: jest.Mock };
  let game: { onPanelAudio: jest.Mock; onPanelImage: jest.Mock; isImagePending: jest.Mock };
  let processor: StoryMediaProcessor;

  const job = (name: StoryMediaJobName, order: number) =>
    ({ name, data: panel(order) }) as Job<PanelMediaRequestEvent, void, StoryMediaJobName>;

  beforeEach(() => {
    media = {
      generateAudio: jest.fn().mockResolvedValue(AUDIO),
      generateImage: jest.fn().mockResolvedValue(IMAGE),
    };
    game = {
      onPanelAudio: jest.fn().mockResolvedValue(undefined),
      onPanelImage: jest.fn().mockResolvedValue(undefined),
      isImagePending: jest.fn().mockResolvedValue(true),
    };
    processor = new StoryMediaProcessor(
      media as unknown as StoryMediaService,
      game as unknown as StoryGameService,
    );
  });

  it('narrates the panel and hands the audio to the game', async () => {
    await processor.process(job('panel-audio', 2));
    expect(media.generateAudio).toHaveBeenCalledWith(panel(2));
    expect(game.onPanelAudio).toHaveBeenCalledWith('g1', 2, AUDIO);
    expect(media.generateImage).not.toHaveBeenCalled();
  });

  it('draws the panel and hands the image to the game', async () => {
    await processor.process(job('panel-image', 2));
    expect(game.isImagePending).toHaveBeenCalledWith('g1', 2);
    expect(media.generateImage).toHaveBeenCalledWith(panel(2));
    expect(game.onPanelImage).toHaveBeenCalledWith('g1', 2, IMAGE);
  });

  it('does not call the provider when the image is no longer pending (429 or deadline)', async () => {
    game.isImagePending.mockResolvedValue(false);
    await processor.process(job('panel-image', 2));
    expect(media.generateImage).not.toHaveBeenCalled();
    expect(game.onPanelImage).not.toHaveBeenCalled();
  });
});
