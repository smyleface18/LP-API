import { InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime';
import { EnvsService } from '@/common/src/envs/envs.service';
import { NovaCanvasImageService } from './nova-canvas-image.service';

const input = {
  seed: 42,
  scene: 'A park',
  text: 'Max played with a ball.',
  characters: [{ name: 'Max', kind: 'dog', description: 'small brown dog' }],
};

const body = (value: object) => new TextEncoder().encode(JSON.stringify(value));

describe('NovaCanvasImageService (Bedrock mocked)', () => {
  let send: jest.Mock;
  let envs: { bedrockImageModelId: string | undefined };
  let service: NovaCanvasImageService;

  beforeEach(() => {
    send = jest.fn().mockResolvedValue({
      body: body({ images: [Buffer.from('png-bytes').toString('base64')] }),
    });
    envs = { bedrockImageModelId: 'amazon.nova-canvas-v1:0' };
    service = new NovaCanvasImageService({ send } as never, envs as unknown as EnvsService);
  });

  it('draws one TEXT_IMAGE with the story seed and decodes it', async () => {
    const image = await service.generate(input);

    expect(Buffer.from(image!.image).toString()).toBe('png-bytes');
    expect(image!.contentType).toBe('image/png');
    const [[command]] = send.mock.calls as [InvokeModelCommand][];
    expect(command.input.modelId).toBe('amazon.nova-canvas-v1:0');
    const request = JSON.parse(command.input.body as string) as {
      taskType: string;
      textToImageParams: { text: string; negativeText: string };
      imageGenerationConfig: Record<string, unknown>;
    };
    expect(request.taskType).toBe('TEXT_IMAGE');
    expect(request.textToImageParams.text).toContain('Max is a dog: small brown dog');
    expect(request.textToImageParams.negativeText).toContain('speech bubbles');
    expect(request.imageGenerationConfig).toMatchObject({ numberOfImages: 1, seed: 42 });
  });

  it('returns null without a model or when Bedrock blocks the image', async () => {
    send.mockResolvedValue({ body: body({ images: [], error: 'blocked by content filters' }) });
    expect(await service.generate(input)).toBeNull();

    envs.bedrockImageModelId = undefined;
    send.mockClear();
    expect(await service.generate(input)).toBeNull();
    expect(send).not.toHaveBeenCalled();
  });
});
