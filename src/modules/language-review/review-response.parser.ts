import {
  CharacterCorrection,
  Correction,
  CorrectionType,
  LanguageReview,
  LanguageReviewInput,
} from './language-review.types';

/** La respuesta del modelo no es JSON válido o no respeta el esquema: se reintenta. */
export class InvalidReviewResponseError extends Error {
  constructor(reason: string) {
    super(`Invalid review response: ${reason}`);
    this.name = 'InvalidReviewResponseError';
  }
}

const CORRECTION_TYPES: readonly CorrectionType[] = [
  'grammar',
  'spelling',
  'vocabulary',
  'punctuation',
];
const CHARACTER_FIELDS: readonly CharacterCorrection['field'][] = ['name', 'kind', 'description'];

type Json = Record<string, unknown>;

const isObject = (value: unknown): value is Json =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const isString = (value: unknown): value is string => typeof value === 'string';

/** Saca el objeto JSON de la respuesta, tolerando un bloque ```json alrededor. */
function extractJson(raw: string): unknown {
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start === -1 || end < start) throw new InvalidReviewResponseError('no JSON object');
  try {
    return JSON.parse(raw.slice(start, end + 1));
  } catch {
    throw new InvalidReviewResponseError('malformed JSON');
  }
}

function requireArray(value: unknown, field: string): unknown[] {
  if (!Array.isArray(value)) throw new InvalidReviewResponseError(`${field} is not an array`);
  return value;
}

function toCorrection(item: unknown): Correction {
  if (
    !isObject(item) ||
    !isString(item.original) ||
    !isString(item.suggestion) ||
    !isString(item.explanation) ||
    !CORRECTION_TYPES.includes(item.type as CorrectionType)
  ) {
    throw new InvalidReviewResponseError('bad correction');
  }
  return {
    original: item.original,
    suggestion: item.suggestion,
    type: item.type as CorrectionType,
    explanation: item.explanation,
  };
}

function toCharacterCorrection(item: unknown): CharacterCorrection {
  if (
    !isObject(item) ||
    !Number.isInteger(item.characterIndex) ||
    !CHARACTER_FIELDS.includes(item.field as CharacterCorrection['field']) ||
    !isString(item.original) ||
    !isString(item.suggestion) ||
    !isString(item.explanation)
  ) {
    throw new InvalidReviewResponseError('bad character correction');
  }
  return {
    characterIndex: item.characterIndex as number,
    field: item.field as CharacterCorrection['field'],
    original: item.original,
    suggestion: item.suggestion,
    explanation: item.explanation,
  };
}

/**
 * Valida la respuesta del modelo contra el esquema de LanguageReview.
 *
 * - Estructura inválida → InvalidReviewResponseError (el servicio reintenta).
 * - Correcciones que no se pueden aplicar (su `original` no está en el texto,
 *   o no cambian nada) se descartan: el puntaje se calcula con la cantidad de
 *   correcciones, y una inventada castigaría al jugador.
 * - Sin correcciones, `correctedText` es el texto original: el modelo no puede
 *   reescribir un texto sin errores.
 */
export function parseReviewResponse(raw: string, input: LanguageReviewInput): LanguageReview {
  const data = extractJson(raw);
  if (!isObject(data)) throw new InvalidReviewResponseError('not an object');
  if (!isString(data.correctedText) || data.correctedText.trim() === '') {
    throw new InvalidReviewResponseError('correctedText missing');
  }
  if (typeof data.flagged !== 'boolean') throw new InvalidReviewResponseError('flagged missing');

  const corrections = requireArray(data.corrections, 'corrections')
    .map(toCorrection)
    .filter(
      (correction) =>
        correction.original !== '' &&
        correction.original !== correction.suggestion &&
        input.text.includes(correction.original),
    );

  const characterCorrections = requireArray(data.characterCorrections ?? [], 'characterCorrections')
    .map(toCharacterCorrection)
    .filter((correction) => {
      const sheet = input.newCharacters[correction.characterIndex];
      return (
        sheet !== undefined &&
        correction.original !== '' &&
        correction.original !== correction.suggestion &&
        sheet[correction.field].includes(correction.original)
      );
    });

  return {
    correctedText: corrections.length > 0 ? data.correctedText : input.text,
    corrections,
    characterCorrections,
    flagged: data.flagged,
  };
}
