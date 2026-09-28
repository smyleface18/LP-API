import { CloudflareImageGenerator, FetchFn } from './cloudflare-image.generator';
import { ImageFailureKind, ImageGenerationError } from './image-generator';
import { buildPanelImagePrompt } from './panel-image-prompt';
import { CF_IMAGE_STEPS, DEFAULT_IMAGE_TIMEOUT_MS } from './story-media.config';
import { PanelImageInput } from './story-media.types';

const CONFIG = {
  accountId: 'acc-123',
  apiToken: 'token-abc',
  model: '@cf/black-forest-labs/flux-1-schnell',
  timeoutMs: DEFAULT_IMAGE_TIMEOUT_MS,
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

const cfError = (status: number, message: string) =>
  jsonResponse(status, {
    result: null,
    success: false,
    errors: [{ code: 10000, message }],
    messages: [],
  });

/** Error que lanzó `generate`, para revisar su `kind`. */
async function failureOf(promise: Promise<unknown>): Promise<ImageGenerationError> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(ImageGenerationError);
    return error as ImageGenerationError;
  }
  throw new Error('expected generate to throw');
}

describe('CloudflareImageGenerator', () => {
  let fetchFn: jest.MockedFunction<FetchFn>;
  let generator: CloudflareImageGenerator;

  beforeEach(() => {
    fetchFn = jest.fn();
    generator = new CloudflareImageGenerator(CONFIG, fetchFn);
  });

  afterEach(() => jest.useRealTimers());

  it('posts only the prompt and steps (the model rejects any other field) and decodes the image', async () => {
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
      steps: CF_IMAGE_STEPS,
    });
  });

  it('detects a PNG image', async () => {
    fetchFn.mockResolvedValue(ok(PNG));
    expect((await generator.generate(INPUT)).contentType).toBe('image/png');
  });

  it.each<[number, ImageFailureKind]>([
    [400, 'permanent'],
    [401, 'permanent'],
    [403, 'permanent'],
    [404, 'permanent'],
    [429, 'rate-limited'],
    [500, 'transient'],
    [503, 'transient'],
  ])('classifies HTTP %i as %s, with the message from Cloudflare', async (status, kind) => {
    fetchFn.mockResolvedValue(cfError(status, 'Something went wrong'));
    const error = await failureOf(generator.generate(INPUT));
    expect(error.kind).toBe(kind);
    expect(error.message).toBe(`Workers AI responded ${status}: Something went wrong`);
  });

  it('classifies an HTTP error without a JSON body by its status', async () => {
    fetchFn.mockResolvedValue(new Response('Bad gateway', { status: 502 }));
    const error = await failureOf(generator.generate(INPUT));
    expect(error.kind).toBe('transient');
    expect(error.message).toMatch(/^Workers AI responded 502/);
  });

  it('fails permanently when the response has no image', async () => {
    fetchFn.mockResolvedValue(jsonResponse(200, { result: {}, success: true, errors: [] }));
    const error = await failureOf(generator.generate(INPUT));
    expect(error).toMatchObject({ kind: 'permanent', message: 'Workers AI returned no image' });
  });

  it('fails permanently when the image is not a JPEG or a PNG', async () => {
    fetchFn.mockResolvedValue(ok(Buffer.from('not an image')));
    const error = await failureOf(generator.generate(INPUT));
    expect(error.kind).toBe('permanent');
    expect(error.message).toMatch(/unknown image format/);
  });

  it('treats a network error as transient', async () => {
    fetchFn.mockRejectedValue(new TypeError('fetch failed'));
    const error = await failureOf(generator.generate(INPUT));
    expect(error).toMatchObject({
      kind: 'transient',
      message: 'Workers AI request failed: fetch failed',
    });
  });

  it('aborts the request after timeoutMs and fails as transient', async () => {
    jest.useFakeTimers();
    generator = new CloudflareImageGenerator({ ...CONFIG, timeoutMs: 5_000 }, fetchFn);
    let signal: AbortSignal | undefined;
    fetchFn.mockImplementation(
      (_url, init) =>
        new Promise((_resolve, reject) => {
          signal = init.signal as AbortSignal;
          signal.addEventListener('abort', () => reject(new Error('This operation was aborted')));
        }),
    );

    const failure = failureOf(generator.generate(INPUT));
    await jest.advanceTimersByTimeAsync(4_999);
    expect(signal?.aborted).toBe(false);
    await jest.advanceTimersByTimeAsync(1);

    expect(await failure).toMatchObject({
      kind: 'transient',
      message: 'Workers AI timed out after 5000 ms',
    });
    expect(signal?.aborted).toBe(true);
  });
});
