import {
  SCORE_ERROR_WEIGHT,
  SCORE_FIRST_TRY_BONUS,
  SCORE_REVIEW_UNAVAILABLE,
  SCORE_SELF_CORRECTION_BONUS,
} from '../story-game.config';
import { countWords } from './story-text';
import { PanelConfirmedBy, PanelDraft, PanelScore } from './story-game.types';

/**
 * Puntaje de una viñeta al cerrarse. Se calcula solo en el servidor, con la
 * cantidad de errores; nunca con un puntaje del modelo.
 *
 *   palabras  = palabras del texto final del jugador (último borrador)
 *   errores   = correcciones de la ÚLTIMA revisión
 *   precisión = round(100 × max(0, 1 − SCORE_ERROR_WEIGHT × errores / palabras))
 *
 * - +SCORE_FIRST_TRY_BONUS si la revisión 1 no tuvo errores.
 * - +SCORE_SELF_CORRECTION_BONUS si la revisión 2 tiene menos errores que la 1.
 * - Confirmada por timeout: la precisión vale la mitad (los bonos no cambian).
 * - Sin texto (el turno venció sin borradores): 0.
 * - El último borrador no se pudo revisar (IA caída): SCORE_REVIEW_UNAVAILABLE
 *   fijos, para no castigar al jugador por una falla del sistema.
 *
 * "Revisión n" = n-ésimo borrador que sí se revisó (los que consumen intento).
 */
export function calculatePanelScore(
  drafts: PanelDraft[],
  confirmedBy: PanelConfirmedBy,
): PanelScore {
  const last = drafts.at(-1);
  if (!last) {
    return {
      accuracy: 0,
      firstTryBonus: 0,
      selfCorrectionBonus: 0,
      timeoutPenalty: confirmedBy === 'timeout',
      total: 0,
    };
  }

  if (!last.review) {
    return {
      accuracy: SCORE_REVIEW_UNAVAILABLE,
      firstTryBonus: 0,
      selfCorrectionBonus: 0,
      timeoutPenalty: false,
      total: SCORE_REVIEW_UNAVAILABLE,
    };
  }

  const words = Math.max(1, countWords(last.text));
  const errors = last.review.corrections.length;
  const accuracy = Math.round(100 * Math.max(0, 1 - (SCORE_ERROR_WEIGHT * errors) / words));

  const reviews = drafts.flatMap((draft) => (draft.review ? [draft.review] : []));
  const [first, second] = reviews;
  const firstTryBonus = first.corrections.length === 0 ? SCORE_FIRST_TRY_BONUS : 0;
  const selfCorrectionBonus =
    second && second.corrections.length < first.corrections.length
      ? SCORE_SELF_CORRECTION_BONUS
      : 0;

  const timeoutPenalty = confirmedBy === 'timeout';
  const accuracyPoints = timeoutPenalty ? Math.round(accuracy / 2) : accuracy;

  return {
    accuracy,
    firstTryBonus,
    selfCorrectionBonus,
    timeoutPenalty,
    total: accuracyPoints + firstTryBonus + selfCorrectionBonus,
  };
}
