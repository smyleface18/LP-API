import { Level } from '@/db/enum/question.enum';

export type CorrectionType = 'grammar' | 'spelling' | 'vocabulary' | 'punctuation';

export interface Correction {
  /** Fragmento exacto del texto del jugador. */
  original: string;
  suggestion: string;
  type: CorrectionType;
  /** En español, una o dos frases, adecuada al nivel. */
  explanation: string;
}

/** Corrección de una ficha de personaje nuevo. No suma ni resta puntos. */
export interface CharacterCorrection {
  /** Índice en `newCharacters`. */
  characterIndex: number;
  field: 'name' | 'kind' | 'description';
  original: string;
  suggestion: string;
  explanation: string;
}

/** Resultado de revisar un borrador (texto + fichas nuevas) en una sola llamada. */
export interface LanguageReview {
  /** Texto del jugador con los errores corregidos. Nunca se envía al jugador durante la partida. */
  correctedText: string;
  corrections: Correction[];
  characterCorrections: CharacterCorrection[];
  /** Contenido inapropiado en el texto, el escenario o las fichas. */
  flagged: boolean;
}

export interface ReviewCharacterSheet {
  name: string;
  kind: string;
  description: string;
}

export interface LanguageReviewInput {
  text: string;
  scene: string;
  level: Level;
  /** Contexto: textos finales de las viñetas anteriores. */
  storySoFar: string[];
  /** Personajes existentes, para que reconozca sus nombres. */
  cast: ReviewCharacterSheet[];
  /** Personajes nuevos de este borrador: se revisan en la misma llamada. */
  newCharacters: ReviewCharacterSheet[];
}
