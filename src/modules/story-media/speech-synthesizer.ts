import { Injectable } from '@nestjs/common';
import { SynthesizedSpeech } from './story-media.types';

/**
 * Narrador de las viñetas. Es también el token de inyección: el módulo decide
 * qué implementación se usa.
 *
 * `synthesize` nunca lanza: si no se puede narrar devuelve null y la viñeta
 * queda `failed` (la historieta se puede leer igual).
 */
export abstract class SpeechSynthesizer {
  abstract synthesize(text: string, languageCode: string): Promise<SynthesizedSpeech | null>;
}

/** Sin narración: para tests. En la app se usa PollySpeechService. */
@Injectable()
export class SilentSpeechSynthesizer extends SpeechSynthesizer {
  synthesize(): Promise<null> {
    return Promise.resolve(null);
  }
}
