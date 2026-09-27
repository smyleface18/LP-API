import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { BedrockRuntimeClient, ConverseCommand } from '@aws-sdk/client-bedrock-runtime';
import { EnvsService } from '@/common/src/envs/envs.service';
import { LanguageReviewer } from './language-reviewer';
import { LanguageReview, LanguageReviewInput } from './language-review.types';
import { REVIEW_TIMEOUT_MS } from './language-review.config';
import { InvalidReviewResponseError, parseReviewResponse } from './review-response.parser';
import { buildReviewSystemPrompt, REVIEW_PROMPT_VERSION } from './prompts/review-system-prompt.v1';

export const BEDROCK_CLIENT = 'BEDROCK_CLIENT';

/** Lo único que se usa del cliente de Bedrock (facilita el mock en tests). */
export type BedrockClient = Pick<BedrockRuntimeClient, 'send'>;

const MAX_ATTEMPTS = 2;
const MAX_OUTPUT_TOKENS = 2_000;

class ReviewTimeoutError extends Error {
  constructor() {
    super(`review took longer than ${REVIEW_TIMEOUT_MS} ms`);
    this.name = 'ReviewTimeoutError';
  }
}

/**
 * Revisión de inglés con Amazon Nova 2 Lite (Bedrock, Converse API).
 *
 * - `temperature: 0`, para que la revisión sea lo más consistente posible.
 * - Presupuesto total de REVIEW_TIMEOUT_MS, incluido un reintento si la
 *   llamada falla o la respuesta no respeta el esquema.
 * - Nunca lanza: ante cualquier problema devuelve null y el juego sigue sin
 *   revisión. La IA nunca bloquea la partida.
 *
 * Credenciales: la cadena estándar del SDK de AWS (variables de entorno, rol
 * de la instancia, etc.); acá no se configuran.
 */
@Injectable()
export class LanguageReviewService extends LanguageReviewer implements OnModuleInit {
  private readonly logger = new Logger(LanguageReviewService.name);

  constructor(
    @Inject(BEDROCK_CLIENT) private readonly client: BedrockClient,
    private readonly envs: EnvsService,
  ) {
    super();
  }

  onModuleInit() {
    if (!this.envs.bedrockReviewModelId) {
      this.logger.error(
        'BEDROCK_REVIEW_MODEL_ID is not set: story drafts will be accepted without review',
      );
    }
  }

  async review(input: LanguageReviewInput): Promise<LanguageReview | null> {
    const modelId = this.envs.bedrockReviewModelId;
    if (!modelId) return null;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REVIEW_TIMEOUT_MS);
    const startedAt = Date.now();

    try {
      for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
        try {
          const raw = await this.converse(modelId, input, controller.signal);
          const review = parseReviewResponse(raw, input);
          this.logger.debug(
            `review ok model=${modelId} prompt=${REVIEW_PROMPT_VERSION} attempt=${attempt} ` +
              `ms=${Date.now() - startedAt} corrections=${review.corrections.length} flagged=${review.flagged}`,
          );
          return review;
        } catch (error) {
          if (error instanceof ReviewTimeoutError || controller.signal.aborted) {
            this.logger.warn(`review timed out after ${REVIEW_TIMEOUT_MS} ms (attempt ${attempt})`);
            return null;
          }
          const kind = error instanceof InvalidReviewResponseError ? 'invalid response' : 'failed';
          this.logger.warn(`review ${kind} (attempt ${attempt}): ${(error as Error).message}`);
        }
      }
      return null;
    } finally {
      clearTimeout(timer);
    }
  }

  private async converse(
    modelId: string,
    input: LanguageReviewInput,
    signal: AbortSignal,
  ): Promise<string> {
    const request = this.client.send(
      new ConverseCommand({
        modelId,
        system: [{ text: buildReviewSystemPrompt(input.level) }],
        messages: [
          {
            role: 'user',
            content: [
              {
                text: JSON.stringify({
                  text: input.text,
                  scene: input.scene,
                  storySoFar: input.storySoFar,
                  existingCharacters: input.cast,
                  newCharacters: input.newCharacters,
                }),
              },
            ],
          },
        ],
        inferenceConfig: { temperature: 0, maxTokens: MAX_OUTPUT_TOKENS },
      }),
      { abortSignal: signal },
    );

    // Por si el cliente no respeta el abort: el timeout gana igual.
    const response = await Promise.race([
      request,
      new Promise<never>((_, reject) => {
        if (signal.aborted) reject(new ReviewTimeoutError());
        signal.addEventListener('abort', () => reject(new ReviewTimeoutError()), { once: true });
      }),
    ]);

    const text = (response.output?.message?.content ?? [])
      .map((block) => block.text ?? '')
      .join('');
    if (!text) throw new InvalidReviewResponseError('empty response');
    return text;
  }
}
