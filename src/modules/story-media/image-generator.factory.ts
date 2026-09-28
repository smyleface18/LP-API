import { EnvsService } from '@/common/src/envs/envs.service';
import { ImageGenerator, NullImageGenerator } from './image-generator';
import { CloudflareImageGenerator, FetchFn } from './cloudflare-image.generator';
import { CF_DEFAULT_IMAGE_MODEL, DEFAULT_IMAGE_TIMEOUT_MS } from './story-media.config';

export const IMAGE_PROVIDERS = ['none', 'cloudflare'] as const;
export type ImageProvider = (typeof IMAGE_PROVIDERS)[number];

/** `IMAGE_TIMEOUT_MS`: entero positivo; sin definir, DEFAULT_IMAGE_TIMEOUT_MS. */
function imageTimeoutMs(envs: EnvsService): number {
  const raw = envs.optional('IMAGE_TIMEOUT_MS');
  if (raw === undefined) return DEFAULT_IMAGE_TIMEOUT_MS;
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`Invalid IMAGE_TIMEOUT_MS "${raw}": use a positive number of milliseconds`);
  }
  return value;
}

/**
 * Elige el dibujante según `IMAGE_PROVIDER` (por defecto `none`). Lanza al
 * arrancar si el valor no existe, si falta una variable del proveedor o si
 * `IMAGE_TIMEOUT_MS` no es válido: la app no arranca con una configuración a medias.
 */
export function createImageGenerator(envs: EnvsService, fetchFn?: FetchFn): ImageGenerator {
  const provider = envs.optional('IMAGE_PROVIDER') ?? 'none';
  if (!(IMAGE_PROVIDERS as readonly string[]).includes(provider)) {
    throw new Error(
      `Invalid IMAGE_PROVIDER "${provider}": use one of ${IMAGE_PROVIDERS.join(', ')}`,
    );
  }
  if (provider === 'none') return new NullImageGenerator();

  const required = (key: string) => {
    const value = envs.optional(key);
    if (!value) throw new Error(`IMAGE_PROVIDER=cloudflare needs the env variable ${key}`);
    return value;
  };
  return new CloudflareImageGenerator(
    {
      accountId: required('CF_ACCOUNT_ID'),
      apiToken: required('CF_API_TOKEN'),
      model: envs.optional('CF_IMAGE_MODEL') ?? CF_DEFAULT_IMAGE_MODEL,
      timeoutMs: imageTimeoutMs(envs),
    },
    fetchFn,
  );
}
