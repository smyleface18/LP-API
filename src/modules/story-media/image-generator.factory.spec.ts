import { EnvsService } from '@/common/src/envs/envs.service';
import { NullImageGenerator } from './image-generator';
import { createImageGenerator } from './image-generator.factory';
import { CloudflareImageGenerator, FetchFn } from './cloudflare-image.generator';

const envsWith = (values: Record<string, string>) =>
  ({ optional: (key: string) => values[key]?.trim() || undefined }) as unknown as EnvsService;

const CLOUDFLARE = { IMAGE_PROVIDER: 'cloudflare', CF_ACCOUNT_ID: 'acc', CF_API_TOKEN: 'tok' };

const INPUT = { seed: 1, scene: 's', text: 't', characters: [] };

describe('createImageGenerator', () => {
  it('uses no images by default', () => {
    expect(createImageGenerator(envsWith({}))).toBeInstanceOf(NullImageGenerator);
  });

  it("uses no images with IMAGE_PROVIDER='none'", () => {
    expect(createImageGenerator(envsWith({ IMAGE_PROVIDER: 'none' }))).toBeInstanceOf(
      NullImageGenerator,
    );
  });

  it("uses Cloudflare with IMAGE_PROVIDER='cloudflare' and flux-1-schnell by default", async () => {
    const fetchFn: jest.MockedFunction<FetchFn> = jest
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ result: { image: 'iVBORw0KGgo=' }, success: true })),
      );
    const generator = createImageGenerator(envsWith(CLOUDFLARE), fetchFn);

    expect(generator).toBeInstanceOf(CloudflareImageGenerator);
    await generator.generate(INPUT);
    expect(fetchFn.mock.calls[0][0]).toBe(
      'https://api.cloudflare.com/client/v4/accounts/acc/ai/run/@cf/black-forest-labs/flux-1-schnell',
    );
    expect(fetchFn.mock.calls[0][1].headers).toMatchObject({ Authorization: 'Bearer tok' });
  });

  it('uses CF_IMAGE_MODEL when it is set', async () => {
    const fetchFn: jest.MockedFunction<FetchFn> = jest
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ result: { image: 'iVBORw0KGgo=' }, success: true })),
      );
    const envs = envsWith({ ...CLOUDFLARE, CF_IMAGE_MODEL: '@cf/other/model' });
    await createImageGenerator(envs, fetchFn).generate(INPUT);
    expect(fetchFn.mock.calls[0][0]).toMatch(/\/ai\/run\/@cf\/other\/model$/);
  });

  it.each(['CF_ACCOUNT_ID', 'CF_API_TOKEN'])('fails to start without %s', (missing) => {
    const envs = envsWith({ ...CLOUDFLARE, [missing]: '' });
    expect(() => createImageGenerator(envs)).toThrow(
      `IMAGE_PROVIDER=cloudflare needs the env variable ${missing}`,
    );
  });

  const timeoutOf = (generator: unknown) =>
    (generator as { config: { timeoutMs: number } }).config.timeoutMs;

  it('times out after 20 s by default, or after IMAGE_TIMEOUT_MS', () => {
    expect(timeoutOf(createImageGenerator(envsWith(CLOUDFLARE)))).toBe(20_000);
    expect(
      timeoutOf(createImageGenerator(envsWith({ ...CLOUDFLARE, IMAGE_TIMEOUT_MS: '8000' }))),
    ).toBe(8_000);
  });

  it.each(['0', '-5', 'abc', '1.5'])('fails to start with IMAGE_TIMEOUT_MS=%s', (value) => {
    const envs = envsWith({ ...CLOUDFLARE, IMAGE_TIMEOUT_MS: value });
    expect(() => createImageGenerator(envs)).toThrow(`Invalid IMAGE_TIMEOUT_MS "${value}"`);
  });

  it('fails to start with an unknown provider', () => {
    expect(() => createImageGenerator(envsWith({ IMAGE_PROVIDER: 'nova' }))).toThrow(
      'Invalid IMAGE_PROVIDER "nova": use one of none, cloudflare',
    );
  });
});
