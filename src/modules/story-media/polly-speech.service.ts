import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  Engine,
  LanguageCode,
  PollyClient,
  SynthesizeSpeechCommand,
  VoiceId,
} from '@aws-sdk/client-polly';
import { EnvsService } from '@/common/src/envs/envs.service';
import { SpeechSynthesizer } from './speech-synthesizer';
import { SynthesizedSpeech } from './story-media.types';
import { parseSpeechMarks } from './speech-marks.parser';
import { SPEECH_TIMEOUT_MS } from './story-media.config';

export const POLLY_CLIENT = 'POLLY_CLIENT';

/** Lo único que se usa del cliente de Polly (facilita el mock en tests). */
export type PollySendClient = Pick<PollyClient, 'send'>;

/**
 * Narración con Amazon Polly (voz neural). Hace dos llamadas en paralelo con
 * el mismo texto: el audio (mp3) y las speech marks de cada palabra (json),
 * que el cliente usa para resaltar la palabra que se está leyendo.
 *
 * Nunca lanza: ante cualquier problema devuelve null. Credenciales: la cadena
 * estándar del SDK de AWS, como la revisión con Bedrock.
 */
@Injectable()
export class PollySpeechService extends SpeechSynthesizer {
  private readonly logger = new Logger(PollySpeechService.name);

  constructor(
    @Inject(POLLY_CLIENT) private readonly client: PollySendClient,
    private readonly envs: EnvsService,
  ) {
    super();
  }

  async synthesize(text: string, languageCode: string): Promise<SynthesizedSpeech | null> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), SPEECH_TIMEOUT_MS);
    // config.language ya viene validado ('en-US'); la voz la define el entorno.
    const base = {
      Text: text,
      VoiceId: this.envs.pollyVoiceId as VoiceId,
      Engine: Engine.NEURAL,
      LanguageCode: languageCode as LanguageCode,
    };

    try {
      const [audio, marks] = await Promise.all([
        this.client.send(new SynthesizeSpeechCommand({ ...base, OutputFormat: 'mp3' }), {
          abortSignal: controller.signal,
        }),
        this.client.send(
          new SynthesizeSpeechCommand({ ...base, OutputFormat: 'json', SpeechMarkTypes: ['word'] }),
          { abortSignal: controller.signal },
        ),
      ]);
      if (!audio.AudioStream || !marks.AudioStream) throw new Error('empty response from Polly');

      const [bytes, rawMarks] = await Promise.all([
        audio.AudioStream.transformToByteArray(),
        marks.AudioStream.transformToString('utf-8'),
      ]);
      return {
        audio: bytes,
        contentType: audio.ContentType ?? 'audio/mpeg',
        speechMarks: parseSpeechMarks(rawMarks, text),
      };
    } catch (error) {
      this.logger.warn(`speech failed: ${(error as Error).message}`);
      return null;
    } finally {
      clearTimeout(timer);
    }
  }
}
