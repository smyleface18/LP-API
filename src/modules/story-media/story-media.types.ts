import {
  CharacterSheet,
  PanelImageStatus,
  PanelMedia,
  SpeechMark,
} from '@/modules/story-game/domain/story-game.types';

export type { SpeechMark };

/** Audio narrado de una viñeta, con la marca de tiempo de cada palabra. */
export interface SynthesizedSpeech {
  audio: Uint8Array;
  contentType: string;
  /** Offsets en caracteres del texto narrado (no en bytes, como los da Polly). */
  speechMarks: SpeechMark[];
}

export interface GeneratedImage {
  image: Uint8Array;
  contentType: string;
}

/** Lo que hace falta para dibujar una viñeta. */
export interface PanelImageInput {
  /** Semilla estable por historieta: ayuda a que las viñetas compartan estilo. */
  seed: number;
  scene: string;
  text: string;
  characters: CharacterSheet[];
}

/** Una viñeta a generar (dato de la tarea de la cola `story-media`). */
export interface PanelMediaRequest {
  gameId: string;
  storyId: string;
  order: number;
  /** Texto corregido: el que se narra. */
  text: string;
  scene: string;
  /** Personajes que aparecen en la viñeta. */
  characters: CharacterSheet[];
  /** Idioma de la narración (config.language), ej. `en-US`. */
  languageCode: string;
}

/** Resultado de generar una viñeta: nunca `pending` (ni `none` en el audio). */
export type PanelMediaResult = PanelMedia & {
  status: 'ready' | 'failed';
  imageStatus: Exclude<PanelImageStatus, 'pending'>;
};
