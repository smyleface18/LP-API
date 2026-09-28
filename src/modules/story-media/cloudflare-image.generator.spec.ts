import { CloudflareImageGenerator, FetchFn } from './cloudflare-image.generator';
import { buildPanelImagePrompt } from './panel-image-prompt';
import { CF_IMAGE_STEPS, IMAGE_TIMEOUT_MS } from './story-media.config';
import { PanelImageInput } from './story-media.types';

const CONFIG = {
  accountId: 'acc-123',
  apiToken: 'token-abc',
  model: '@cf/black-forest-labs/flux-1-schnell',
};

const INPUT: PanelImageInput = {
  seed: 42,
  scene: 'A dark forest at night',
  text: 'Max found a shiny key.',
  characters: [{ name: 'Max', kind: 'robot', description: 'small silver robot' }],
};

const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a]);

const jsonResponse = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

const ok = (image: Buffer) =>
  jsonResponse(200, {
    result: { image: image.toString('base64') },
    success: true,
    errors: [],
    messages: [],
  });

describe('CloudflareImageGenerator', () => {
  let fetchFn: jest.MockedFunction<FetchFn>;
  let generator: CloudflareImageGenerator;

  beforeEach(() => {
    fetchFn = jest.fn();
    generator = new CloudflareImageGenerator(CONFIG, fetchFn);
  });

  afterEach(() => jest.useRealTimers());

  it('posts the prompt, seed and steps to the model and decodes the base64 image', async () => {
    fetchFn.mockResolvedValue(ok(JPEG));

    const result = await generator.generate(INPUT);

    expect(result).toEqual({ image: JPEG, contentType: 'image/jpeg' });
    const [url, init] = fetchFn.mock.calls[0];
    expect(url).toBe(
      'https://api.cloudflare.com/client/v4/accounts/acc-123/ai/run/@cf/black-forest-labs/flux-1-schnell',
    );
    expect(init.method).toBe('POST');
    expect(init.headers).toMatchObject({ Authorization: 'Bearer token-abc' });
    expect(JSON.parse(init.body as string)).toEqual({
      prompt: buildPanelImagePrompt(INPUT),
      seed: 42,
      steps: CF_IMAGE_STEPS,
    });
  });

  it('detects a PNG image', async () => {
    fetchFn.mockResolvedValue(ok(PNG));
    expect((await generator.generate(INPUT)).contentType).toBe('image/png');
  });

  it('throws on an HTTP error, with the message from Cloudflare', async () => {
    fetchFn.mockResolvedValue(
      jsonResponse(401, {
        result: null,
        success: false,
        errors: [{ code: 10000, message: 'Authentication error' }],
        messages: [],
      }),
    );
    await expect(generator.generate(INPUT)).rejects.toThrow(
      'Workers AI responded 401: Authentication error',
    );
  });

  it('throws on an HTTP error without a JSON body', async () => {
    fetchFn.mockResolvedValue(new Response('Bad gateway', { status: 502 }));
    await expect(generator.generate(INPUT)).rejects.toThrow('Workers AI responded 502');
  });

  it('throws when the response has no image', async () => {
    fetchFn.mockResolvedValue(jsonResponse(200, { result: {}, success: true, errors: [] }));
    await expect(generator.generate(INPUT)).rejects.toThrow('Workers AI returned no image');
  });

  it('throws when the image is not a JPEG or a PNG', async () => {
    fetchFn.mockResolvedValue(ok(Buffer.from('not an image')));
    await expect(generator.generate(INPUT)).rejects.toThrow('unknown image format');
  });

  it(`aborts the request and throws after ${IMAGE_TIMEOUT_MS} ms`, async () => {
    jest.useFakeTimers();
    let signal: AbortSignal | undefined;
    fetchFn.mockImplementation(
      (_url, init) =>
        new Promise((_resolve, reject) => {
          signal = init.signal as AbortSignal;
          signal.addEventListener('abort', () => reject(new Error('This operation was aborted')));
        }),
    );

    const result = generator.generate(INPUT);
    const assertion = expect(result).rejects.toThrow(`timed out after ${IMAGE_TIMEOUT_MS} ms`);
    await jest.advanceTimersByTimeAsync(IMAGE_TIMEOUT_MS - 1);
    expect(signal?.aborted).toBe(false);
    await jest.advanceTimersByTimeAsync(1);

    await assertion;
    expect(signal?.aborted).toBe(true);
  });
});
