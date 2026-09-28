import { ImageGenerationError, ImageGenerator, ImageFailureKind } from './image-generator';
import { GeneratedImage, PanelImageInput } from './story-media.types';
import { buildPanelImagePrompt } from './panel-image-prompt';
import { CF_IMAGE_STEPS } from './story-media.config';

export interface CloudflareImageConfig {
  accountId: string;
  apiToken: string;
  /** Ej. `@cf/black-forest-labs/flux-1-schnell`. */
  model: string;
  /** Tiempo máximo de cada petición (`IMAGE_TIMEOUT_MS`). */
  timeoutMs: number;
}

/** Lo que se usa de `fetch` (facilita el mock en tests). */
export type FetchFn = (url: string, init: RequestInit) => Promise<Response>;

/** Sobre de la API REST de Cloudflare: `result` trae la salida del modelo. */
interface WorkersAiResponse {
  success?: boolean;
  errors?: { code?: number; message?: string }[];
  result?: { image?: string };
}

/** 429: cuota superada. 5xx: error del servicio, se reintenta. Cualquier otro 4xx no. */
function failureKindOf(status: number): ImageFailureKind {
  if (status === 429) return 'rate-limited';
  if (status >= 500) return 'transient';
  return 'permanent';
}

/**
 * Tipo de la imagen según sus primeros bytes. FLUX.1 schnell devuelve JPEG,
 * pero la documentación no lo fija, así que se detecta.
 */
function imageTypeOf(bytes: Uint8Array): string | null {
  if (bytes[0] === 0xff && bytes[1] === 0xd8) return 'image/jpeg';
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
    return 'image/png';
  }
  return null;
}

/**
 * Dibujo de las viñetas con Cloudflare Workers AI (API REST, `POST
 * /accounts/{id}/ai/run/{model}`). Una imagen por viñeta, con la semilla de la
 * partida para que el estilo se mantenga entre viñetas.
 *
 * Lanza un `ImageGenerationError` si la API falla, responde sin imagen o tarda
 * más de `timeoutMs`; su `kind` decide si `StoryMediaService` reintenta.
 */
export class CloudflareImageGenerator extends ImageGenerator {
  constructor(
    private readonly config: CloudflareImageConfig,
    private readonly fetchFn: FetchFn = (url, init) => fetch(url, init),
  ) {
    super();
  }

  async generate(input: PanelImageInput): Promise<GeneratedImage> {
    const { accountId, apiToken, model, timeoutMs } = this.config;
    const url = `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/run/${model}`;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await this.fetchFn(url, {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: buildPanelImagePrompt(input),
          seed: input.seed,
          steps: CF_IMAGE_STEPS,
        }),
        signal: controller.signal,
      });

      const body = (await response.json().catch(() => null)) as WorkersAiResponse | null;
      if (!response.ok || body?.success === false) {
        const reason = body?.errors?.map((e) => e.message).join('; ') || response.statusText;
        throw new ImageGenerationError(
          `Workers AI responded ${response.status}: ${reason}`,
          response.ok ? 'permanent' : failureKindOf(response.status),
        );
      }

      const encoded = body?.result?.image;
      if (!encoded) throw new ImageGenerationError('Workers AI returned no image', 'permanent');
      const image = Buffer.from(encoded, 'base64');
      const contentType = imageTypeOf(image);
      if (!contentType) {
        throw new ImageGenerationError('Workers AI returned an unknown image format', 'permanent');
      }
      return { image, contentType };
    } catch (error) {
      if (error instanceof ImageGenerationError) throw error;
      if (controller.signal.aborted) {
        throw new ImageGenerationError(`Workers AI timed out after ${timeoutMs} ms`, 'transient');
      }
      // fetch rechaza con TypeError si falla la red (DNS, conexión cortada...).
      throw new ImageGenerationError(
        `Workers AI request failed: ${(error as Error).message}`,
        'transient',
      );
    } finally {
      clearTimeout(timer);
    }
  }
}
