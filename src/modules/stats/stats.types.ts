import { Level } from '@/db/enum/question.enum';

/** Porcentaje entero (0–100). */
export type Percentage = number;

/** Estadísticas del jugador que pide (`GET /stats/me`). */
export interface PlayerStats {
  score: number;
  level: Level;
  gamesPlayed: number;
  gamesWon: number;
  currentStreak: number;
  /** Partidas de trivia ganadas / jugadas. */
  winRate: Percentage;
  trivia: {
    questionsAnswered: number;
    correctAnswers: number;
    /** Respuestas correctas / respondidas. */
    accuracy: Percentage;
    /** Categorías distintas en las que respondió al menos una pregunta. */
    categoriesPracticed: number;
  };
  /** Por nivel CEFR de las preguntas que respondió (solo los niveles que practicó). */
  levels: { level: Level; answered: number; accuracy: Percentage }[];
  stories: {
    /** Historietas terminadas (publicadas) en las que participó. */
    played: number;
    panelsWritten: number;
    totalScore: number;
    /** Promedio por viñeta en todas sus historietas; 0 sin viñetas. */
    averagePanelScore: number;
  };
}

/** Estadísticas de la app para el admin (`GET /admin/stats`). */
export interface AdminStats {
  users: {
    total: number;
    players: number;
    admins: number;
    /** Usuarios con una partida de trivia o una historieta en los últimos 7 días. */
    activeThisWeek: number;
    /** Activos esta semana / jugadores. */
    activeRate: Percentage;
    newThisWeek: number;
  };
  content: { questions: number; categories: number };
  trivia: {
    games: number;
    questionsAnswered: number;
    accuracy: Percentage;
    /** Suma de partidas ganadas / suma de jugadas, de todos los usuarios. */
    winRate: Percentage;
  };
  stories: { total: number; published: number; removed: number; panels: number };
  /** Partidas de trivia + historietas por nivel CEFR (solo los niveles usados). */
  levelUsage: {
    level: Level;
    triviaGames: number;
    stories: number;
    percentage: Percentage;
  }[];
  /** Respuestas de trivia por categoría, de la que más tiene a la que menos. */
  categoryDistribution: { category: string; answers: number; percentage: Percentage }[];
}
