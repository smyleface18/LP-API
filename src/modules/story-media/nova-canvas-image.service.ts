import { Inject, Injectable, Logger } from '@nestjs/common';
import { BedrockRuntimeClient, InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime';
import { EnvsService } from '@/common/src/envs/envs.service';
import { ImageGenerator } from './image-generator';
import { GeneratedImage, PanelImageInput } from './story-media.types';
import { buildPanelImagePrompt, PANEL_NEGATIVE_PROMPT } from './panel-image-prompt';
import { IMAGE_HEIGHT, IMAGE_TIMEOUT_MS, IMAGE_WIDTH } from './story-media.config';

export const IMAGE_BEDROCK_CLIENT = 'IMAGE_BEDROCK_CLIENT';

/** Lo único que se usa del cliente de Bedrock (facilita el mock en tests). */
export type ImageBedrockClient = Pick<BedrockRuntimeClient, 'send'>;

interface NovaCanvasResponse {
  images?: string[];
  error?: string | null;
}

/**
 * Dibujo de las viñetas con Amazon Nova Canvas (Bedrock, InvokeModel,
 * TEXT_IMAGE). Una imagen por viñeta, con la semilla de la historieta para
 * que el estilo se mantenga entre viñetas.
 *
 * Nunca lanza: si falla (o el filtro de contenido la bloquea) devuelve null y
 * la viñeta queda sin imagen.
 */
@Injectable()
export class NovaCanvasImageService extends ImageGenerator {
  private readonly logger = new Logger(NovaCanvasImageService.name);

  constructor(
    @Inject(IMAGE_BEDROCK_CLIENT) private readonly client: ImageBedrockClient,
    private readonly envs: EnvsService,
  ) {
    super();
  }

  async generate(input: PanelImageInput): Promise<GeneratedImage | null> {
    const modelId = this.envs.bedrockImageModelId;
    if (!modelId) return null;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), IMAGE_TIMEOUT_MS);
    try {
      const response = await this.client.send(
        new InvokeModelCommand({
          modelId,
          contentType: 'application/json',
          accept: 'application/json',
          body: JSON.stringify({
            taskType: 'TEXT_IMAGE',
            textToImageParams: {
              text: buildPanelImagePrompt(input),
              negativeText: PANEL_NEGATIVE_PROMPT,
            },
            imageGenerationConfig: {
              numberOfImages: 1,
              width: IMAGE_WIDTH,
              height: IMAGE_HEIGHT,
              quality: 'standard',
              cfgScale: 7,
              seed: input.seed,
            },
          }),
        }),
        { abortSignal: controller.signal },
      );

      const raw = new TextDecoder().decode(response.body as Uint8Array);
      const body = JSON.parse(raw) as NovaCanvasResponse;
      const [image] = body.images ?? [];
      if (!image) throw new Error(body.error ?? 'no image in the response');
      return { image: Buffer.from(image, 'base64'), contentType: 'image/png' };
    } catch (error) {
      this.logger.warn(`image failed: ${(error as Error).message}`);
      return null;
    } finally {
      clearTimeout(timer);
    }
  }
}
