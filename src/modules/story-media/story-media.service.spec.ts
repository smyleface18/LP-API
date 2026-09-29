import { StorageService } from '@/common/src/storage/storage.service';
import { StoryMediaService } from './story-media.service';
import { SpeechSynthesizer } from './speech-synthesizer';
import { ImageGenerationError, ImageGenerator } from './image-generator';
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
const PNG = { image: new Uint8Array([2]), contentType: 'image/png' };

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
    images = { generate: jest.fn().mockResolvedValue(PNG) };
    storage = { putObject: jest.fn().mockResolvedValue(undefined) };
    service = new StoryMediaService(
      speech as unknown as SpeechSynthesizer,
      images as unknown as ImageGenerator,
      storage as unknown as StorageService,
    );
  });

  afterEach(() => jest.useRealTimers());

  describe('generateAudio', () => {
    it('narrates the panel and uploads the audio under the story', async () => {
      expect(await service.generateAudio(request)).toEqual({
        status: 'ready',
        audioKey: 'story/story-1/panel-2.mp3',
        speechMarks: MARKS,
      });
      expect(speech.synthesize).toHaveBeenCalledWith('Max walked home.', 'en-US');
      expect(storage.putObject).toHaveBeenCalledWith(
        'story/story-1/panel-2.mp3',
        expect.any(Uint8Array),
        'audio/mpeg',
      );
      expect(images.generate).not.toHaveBeenCalled();
    });

    it('fails without audio', async () => {
      speech.synthesize.mockResolvedValue(null);
      expect(await service.generateAudio(request)).toEqual({
        status: 'failed',
        audioKey: null,
        speechMarks: null,
      });
    });

    it('treats an S3 error as a missing audio', async () => {
      storage.putObject.mockRejectedValue(new Error('S3 down'));
      expect(await service.generateAudio(request)).toMatchObject({ status: 'failed' });
    });
  });

  describe('generateImage', () => {
    it('draws the panel with the seed of the game and uploads it', async () => {
      expect(await service.generateImage(request)).toEqual({
        imageStatus: 'ready',
        imageKey: 'story/story-1/panel-2.png',
      });
      expect(images.generate).toHaveBeenCalledWith({
        seed: seedForGame('g1'),
        scene: 'A street',
        text: 'Max walked home.',
        characters: request.characters,
      });
      expect(speech.synthesize).not.toHaveBeenCalled();
    });

    it('uploads a JPEG image with the .jpg extension', async () => {
      images.generate.mockResolvedValue({ image: new Uint8Array([2]), contentType: 'image/jpeg' });
      expect(await service.generateImage(request)).toEqual({
        imageStatus: 'ready',
        imageKey: 'story/story-1/panel-2.jpg',
      });
    });

    it('is none when there is no image provider', async () => {
      images.generate.mockResolvedValue(null);
      expect(await service.generateImage(request)).toEqual({ imageStatus: 'none', imageKey: null });
    });

    it('is failed when the image cannot be uploaded', async () => {
      storage.putObject.mockRejectedValue(new Error('S3 down'));
      expect(await service.generateImage(request)).toEqual({
        imageStatus: 'failed',
        imageKey: null,
      });
    });

    it('retries a transient error with backoff and keeps the image that works', async () => {
      jest.useFakeTimers();
      images.generate
        .mockRejectedValueOnce(new ImageGenerationError('503', 'transient'))
        .mockRejectedValueOnce(new ImageGenerationError('timed out', 'transient'))
        .mockResolvedValue(PNG);

      const pending = service.generateImage(request);
      await jest.advanceTimersByTimeAsync(IMAGE_RETRY_DELAYS_MS[0] - 1);
      expect(images.generate).toHaveBeenCalledTimes(1);
      await jest.advanceTimersByTimeAsync(1);
      expect(images.generate).toHaveBeenCalledTimes(2);
      await jest.advanceTimersByTimeAsync(IMAGE_RETRY_DELAYS_MS[1]);

      expect(await pending).toMatchObject({ imageStatus: 'ready' });
      expect(images.generate).toHaveBeenCalledTimes(3);
    });

    it('tries 5 times on transient errors, waiting 1, 2, 4 and 8 s in between', async () => {
      jest.useFakeTimers();
      images.generate.mockRejectedValue(new ImageGenerationError('timed out', 'transient'));

      const pending = service.generateImage(request);
      await jest.advanceTimersByTimeAsync(0);
      expect(images.generate).toHaveBeenCalledTimes(1);
      for (const [index, delay] of IMAGE_RETRY_DELAYS_MS.entries()) {
        await jest.advanceTimersByTimeAsync(delay - 1);
        expect(images.generate).toHaveBeenCalledTimes(index + 1);
        await jest.advanceTimersByTimeAsync(1);
        expect(images.generate).toHaveBeenCalledTimes(index + 2);
      }

      expect(await pending).toEqual({ imageStatus: 'failed', imageKey: null, rateLimited: false });
      expect(images.generate).toHaveBeenCalledTimes(5);
      expect(IMAGE_RETRY_DELAYS_MS).toEqual([1_000, 2_000, 4_000, 8_000]);
    });

    it('treats an unknown error as transient', async () => {
      jest.useFakeTimers();
      images.generate.mockRejectedValueOnce(new Error('bug')).mockResolvedValue(PNG);

      const pending = service.generateImage(request);
      await jest.runAllTimersAsync();

      expect(await pending).toMatchObject({ imageStatus: 'ready' });
      expect(images.generate).toHaveBeenCalledTimes(2);
    });

    it('does not retry a permanent error (400, 401, 403)', async () => {
      images.generate.mockRejectedValue(new ImageGenerationError('401', 'permanent'));
      expect(await service.generateImage(request)).toEqual({
        imageStatus: 'failed',
        imageKey: null,
        rateLimited: false,
      });
      expect(images.generate).toHaveBeenCalledTimes(1);
    });

    it('does not retry a 429 and reports it so the rest of the story skips the provider', async () => {
      images.generate.mockRejectedValue(new ImageGenerationError('429', 'rate-limited'));
      expect(await service.generateImage(request)).toEqual({
        imageStatus: 'failed',
        imageKey: null,
        rateLimited: true,
      });
      expect(images.generate).toHaveBeenCalledTimes(1);
    });
  });
});
