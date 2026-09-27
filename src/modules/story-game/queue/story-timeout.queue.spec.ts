import { Queue } from 'bullmq';
import { StoryTimeoutQueue } from './story-timeout.queue';
import { StoryJob } from './type';

describe('StoryTimeoutQueue', () => {
  const now = 1_800_000_000_000;
  const job: StoryJob = {
    gameId: 'brave-red-fox',
    kind: 'abandon-idle',
    seq: 2,
    dueAt: now + 60_000,
  };
  let queue: { add: jest.Mock; remove: jest.Mock };
  let timeouts: StoryTimeoutQueue;

  beforeEach(() => {
    jest.spyOn(Date, 'now').mockReturnValue(now);
    queue = { add: jest.fn().mockResolvedValue({}), remove: jest.fn().mockResolvedValue(1) };
    timeouts = new StoryTimeoutQueue(queue as unknown as Queue);
  });

  afterEach(() => jest.restoreAllMocks());

  it('adds a delayed job with a deterministic id', async () => {
    await timeouts.schedule(job);
    expect(queue.add).toHaveBeenCalledWith('abandon-idle', job, {
      jobId: 'brave-red-fox__2__abandon-idle__1800000060000',
      delay: 60_000,
      removeOnComplete: true,
      removeOnFail: true,
    });
  });

  it('never uses a negative delay', async () => {
    await timeouts.schedule({ ...job, dueAt: now - 5 });
    expect(queue.add).toHaveBeenCalledWith(
      'abandon-idle',
      expect.anything(),
      expect.objectContaining({ delay: 0 }),
    );
  });

  it('removes the job by the same id and swallows failures', async () => {
    await timeouts.cancel(job);
    expect(queue.remove).toHaveBeenCalledWith('brave-red-fox__2__abandon-idle__1800000060000');

    queue.remove.mockRejectedValue(new Error('locked'));
    await expect(timeouts.cancel(job)).resolves.toBeUndefined();
  });
});
