import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConverseCommand } from '@aws-sdk/client-bedrock-runtime';
import { EnvsService } from '@/common/src/envs/envs.service';
import { BEDROCK_CLIENT, BedrockClient } from './language-review.service';
import { StoryTitleInput, StoryTitler } from './story-titler';
import {
  STORY_TITLE_PROMPT_VERSION,
  STORY_TITLE_SYSTEM_PROMPT,
} from './prompts/story-title-prompt.v1';
import { STORY_TITLE_MAX_CHARS, STORY_TITLE_TIMEOUT_MS } from './language-review.config';

const MAX_OUTPUT_TOKENS = 40;

/**
 * Limpia la respuesta del modelo: primera línea, sin prefijo "Title:", sin
 * comillas ni markdown, sin punto final y con los espacios normalizados. Si
 * pasa de STORY_TITLE_MAX_CHARS se corta en la última palabra que entra.
 * Devuelve null si no queda nada.
 */
export function cleanStoryTitle(raw: string): string | null {
  let title = (raw.split(/\r?\n/).find((line) => line.trim()) ?? '').trim();
  title = title.replace(/^(story\s+)?title\s*:\s*/i, '');
  title = title.replace(/^[#*_`"'“”‘’\s]+|[*_`"'“”‘’\s]+$/g, '');
  title = title
    .replace(/[.。]+$/, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (title.length > STORY_TITLE_MAX_CHARS) {
    const cut = title.slice(0, STORY_TITLE_MAX_CHARS + 1);
    const lastSpace = cut.lastIndexOf(' ');
    title = (lastSpace > 0 ? cut.slice(0, lastSpace) : cut.slice(0, STORY_TITLE_MAX_CHARS)).trim();
  }
  return title || null;
}

/**
 * Título de la historieta con el mismo modelo de la revisión de inglés
 * (BEDROCK_REVIEW_MODEL_ID, Converse API). Una sola llamada con
 * STORY_TITLE_TIMEOUT_MS; nunca lanza: sin modelo, con error o con una
 * respuesta vacía devuelve null.
 */
@Injectable()
export class BedrockStoryTitler extends StoryTitler {
  private readonly logger = new Logger(BedrockStoryTitler.name);

  constructor(
    @Inject(BEDROCK_CLIENT) private readonly client: BedrockClient,
    private readonly envs: EnvsService,
  ) {
    super();
  }

  async title(input: StoryTitleInput): Promise<string | null> {
    const modelId = this.envs.bedrockReviewModelId;
    if (!modelId || input.panels.length === 0) return null;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), STORY_TITLE_TIMEOUT_MS);
    const startedAt = Date.now();
    try {
      const response = await this.client.send(
        new ConverseCommand({
          modelId,
          system: [{ text: STORY_TITLE_SYSTEM_PROMPT }],
          messages: [{ role: 'user', content: [{ text: JSON.stringify(input) }] }],
          inferenceConfig: { temperature: 0.5, maxTokens: MAX_OUTPUT_TOKENS },
        }),
        { abortSignal: controller.signal },
      );
      const raw = (response.output?.message?.content ?? []).map((b) => b.text ?? '').join('');
      const title = cleanStoryTitle(raw);
      this.logger.debug(
        `title ok model=${modelId} prompt=${STORY_TITLE_PROMPT_VERSION} ms=${Date.now() - startedAt} ` +
          `title=${JSON.stringify(title)}`,
      );
      return title;
    } catch (error) {
      this.logger.warn(`title failed: ${(error as Error).message}`);
      return null;
    } finally {
      clearTimeout(timer);
    }
  }
}
