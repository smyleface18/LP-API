/**
 * Puntaje por velocidad, con la misma fórmula que Kahoot: una respuesta
 * correcta vale entre MAX_POINTS (instantánea) y MAX_POINTS / 2 (en el último
 * instante); una incorrecta, 0. Premia la rapidez sin castigar demasiado a quien
 * piensa: acertar siempre vale al menos la mitad.
 *
 * El tiempo se mide con el reloj del servidor desde startsAt hasta la llegada
 * de la respuesta, así que incluye la latencia de subida del jugador (en
 * general decenas de ms, pocos puntos).
 */
export const MAX_POINTS = 1000;

export const calculatePoints = (
  isCorrect: boolean,
  responseTimeMs: number,
  questionDurationMs: number,
): number => {
  if (!isCorrect) return 0;
  if (questionDurationMs <= 0) return MAX_POINTS;

  const ratio = Math.min(Math.max(responseTimeMs / questionDurationMs, 0), 1);
  return Math.round(MAX_POINTS * (1 - ratio / 2));
};
