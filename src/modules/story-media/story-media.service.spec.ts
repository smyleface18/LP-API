import { StorageService } from '@/common/src/storage/storage.service';
import { StoryMediaService } from './story-media.service';
import { SpeechSynthesizer } from './speech-synthesizer';
import { ImageGenerator } from './image-generator';
import { PanelMediaRequest } from './story-media.types';
import { seedForGame } from './panel-image-prompt';
import { IMAGE_RETRY_DELAYS_MS } from './story-media.config';

const request: PanelMediaRequest = {
  gameId: 'g1',
  storyId: 'story-1',
  order: 2,
  text: 'Max walked home.',
  scene: 'A street',
  characters: [{ name: 'Max', kind: 'robot', description: 'small robot' }],
  languageCode: 'en-US',
};

const MARKS = [{ time: 0, start: 0, end: 3, value: 'Max' }];

describe('StoryMediaService', () => {
  let speech: { synthesize: jest.Mock };
  let images: { generate: jest.Mock };
  let storage: { putObject: jest.Mock };
  let service: StoryMediaService;

  beforeEach(() => {
    speech = {
      synthesize: jest.fn().mockResolvedValue({
        audio: new Uint8Array([1]),
        contentType: 'audio/mpeg',
        speechMarks: MARKS,
      }),
    };
    images = {
      generate: jest
        .fn()
        .mockResolvedValue({ image: new Uint8Array([2]), contentType: 'image/png' }),
    };
    storage = { putObject: jest.fn().mockResolvedValue(undefined) };
    service = new StoryMediaService(
      speech as unknown as SpeechSynthesizer,
      images as unknown as ImageGenerator,
      storage as unknown as StorageService,
    );
  });

  afterEach(() => jest.useRealTimers());

  it('narrates and draws the panel and uploads both files under the story', async () => {
    const result = await service.generatePanel(request);

    expect(result).toEqual({
      status: 'ready',
      audioKey: 'story/story-1/panel-2.mp3',
      imageKey: 'story/story-1/panel-2.png',
      imageStatus: 'ready',
      speechMarks: MARKS,
    });
    expect(speech.synthesize).toHaveBeenCalledWith('Max walked home.', 'en-US');
    expect(images.generate).toHaveBeenCalledWith({
      seed: seedForGame('g1'),
      scene: 'A street',
      text: 'Max walked home.',
      characters: request.characters,
    });
    expect(storage.putObject).toHaveBeenCalledWith(
      'story/story-1/panel-2.mp3',
      expect.any(Uint8Array),
      'audio/mpeg',
    );
  });

  it('uploads a JPEG image with the .jpg extension', async () => {
    images.generate.mockResolvedValue({ image: new Uint8Array([2]), contentType: 'image/jpeg' });
    expect(await service.generatePanel(request)).toMatchObject({
      imageKey: 'story/story-1/panel-2.jpg',
      imageStatus: 'ready',
    });
    expect(storage.putObject).toHaveBeenCalledWith(
      'story/story-1/panel-2.jpg',
      expect.any(Uint8Array),
      'image/jpeg',
    );
  });

  it('is ready without an image when there is no image provider', async () => {
    images.generate.mockResolvedValue(null);
    expect(await service.generatePanel(request)).toMatchObject({
      status: 'ready',
      imageKey: null,
      imageStatus: 'none',
    });
  });

  it('retries a failed image with backoff and keeps the image that works', async () => {
    jest.useFakeTimers();
    images.generate
      .mockRejectedValueOnce(new Error('503'))
      .mockRejectedValueOnce(new Error('timeout'))
      .mockResolvedValue({ image: new Uint8Array([2]), contentType: 'image/png' });

    const pending = service.generatePanel(request);
    await jest.advanceTimersByTimeAsync(IMAGE_RETRY_DELAYS_MS[0]);
    expect(images.generate).toHaveBeenCalledTimes(2);
    await jest.advanceTimersByTimeAsync(IMAGE_RETRY_DELAYS_MS[1]);

    expect(await pending).toMatchObject({ status: 'ready', imageStatus: 'ready' });
    expect(images.generate).toHaveBeenCalledTimes(3);
  });

  it('marks the image failed after every attempt fails, and keeps the audio', async () => {
    jest.useFakeTimers();
    images.generate.mockRejectedValue(new Error('Workers AI responded 500'));

    const pending = service.generatePanel(request);
    await jest.runAllTimersAsync();

    expect(await pending).toEqual({
      status: 'ready',
      audioKey: 'story/story-1/panel-2.mp3',
      imageKey: null,
      imageStatus: 'failed',
      speechMarks: MARKS,
    });
    expect(images.generate).toHaveBeenCalledTimes(IMAGE_RETRY_DELAYS_MS.length + 1);
  });

  it('marks the image failed when it cannot be uploaded', async () => {
    storage.putObject.mockImplementation((key: string) =>
      key.endsWith('.png') ? Promise.reject(new Error('S3 down')) : Promise.resolve(),
    );
    expect(await service.generatePanel(request)).toMatchObject({
      status: 'ready',
      imageKey: null,
      imageStatus: 'failed',
    });
  });

  it('fails without audio but keeps the image', async () => {
    speech.synthesize.mockResolvedValue(null);
    expect(await service.generatePanel(request)).toEqual({
      status: 'failed',
      audioKey: null,
      imageKey: 'story/story-1/panel-2.png',
      imageStatus: 'ready',
      speechMarks: null,
    });
  });

  it('treats an S3 error as a missing file', async () => {
    storage.putObject.mockImplementation((key: string) =>
      key.endsWith('.mp3') ? Promise.reject(new Error('S3 down')) : Promise.resolve(),
    );
    expect(await service.generatePanel(request)).toMatchObject({
      status: 'failed',
      audioKey: null,
    });
  });
});
