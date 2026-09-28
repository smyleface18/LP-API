import { StorageService } from '@/common/src/storage/storage.service';
import { StoryMediaService } from './story-media.service';
import { SpeechSynthesizer } from './speech-synthesizer';
import { ImageGenerator } from './image-generator';
import { PanelMediaRequest } from './story-media.types';

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

  it('narrates and draws the panel and uploads both files under the story', async () => {
    const result = await service.generatePanel(request);

    expect(result).toEqual({
      status: 'ready',
      audioKey: 'story/story-1/panel-2.mp3',
      imageKey: 'story/story-1/panel-2.png',
      speechMarks: MARKS,
    });
    expect(speech.synthesize).toHaveBeenCalledWith('Max walked home.', 'en-US');
    expect(images.generate).toHaveBeenCalledWith(
      expect.objectContaining({ scene: 'A street', characters: request.characters }),
    );
    expect(storage.putObject).toHaveBeenCalledWith(
      'story/story-1/panel-2.mp3',
      expect.any(Uint8Array),
      'audio/mpeg',
    );
  });

  it('is ready without an image', async () => {
    images.generate.mockResolvedValue(null);
    expect(await service.generatePanel(request)).toMatchObject({ status: 'ready', imageKey: null });
  });

  it('fails without audio but keeps the image', async () => {
    speech.synthesize.mockResolvedValue(null);
    expect(await service.generatePanel(request)).toEqual({
      status: 'failed',
      audioKey: null,
      imageKey: 'story/story-1/panel-2.png',
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
