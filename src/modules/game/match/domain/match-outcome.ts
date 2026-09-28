import { Match } from './match.entity';

/**
 * En una partida en solitario no hay rival: se gana acertando al menos esta
 * fracción de las preguntas.
 */
export const SOLO_WIN_CORRECT_RATIO = 0.5;

/**
 * Quiénes ganaron la partida. Define "partida ganada" para las métricas del
 * jugador (gamesWon, currentStreak):
 * - Con 2+ jugadores: el/los de mayor puntaje (empate en el 1er puesto = ganan
 *   todos los empatados), siempre que sea > 0.
 * - En solitario (un solo jugador en la sala): acertar al menos
 *   SOLO_WIN_CORRECT_RATIO de las preguntas.
 * Quien abandonó la sala (leaveRoom) no gana. Una desconexión no cuenta como
 * abandono: el jugador pudo reconectarse.
 */
export const determineWinners = (match: Match): Set<string> => {
  const players = match.getPlayersWithInfo();
  const eligible = players.filter((player) => !match.hasLeft(player.userId));
  if (eligible.length === 0) return new Set();

  if (players.length === 1) {
    const [player] = eligible;
    const totalQuestions = match.getQuestions().length;
    const correct = match
      .getAnswers()
      .filter((answer) => answer.userId === player.userId && answer.isCorrect).length;

    const won = totalQuestions > 0 && correct >= totalQuestions * SOLO_WIN_CORRECT_RATIO;
    return new Set(won ? [player.userId] : []);
  }

  const topScore = Math.max(...eligible.map((player) => player.matchScore));
  if (topScore <= 0) return new Set();

  return new Set(
    eligible.filter((player) => player.matchScore === topScore).map((player) => player.userId),
  );
};
