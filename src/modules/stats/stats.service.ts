import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { Level } from '@/db/enum/question.enum';
import { UserRoles } from '@/db/enum/roles.enum';
import { StoryVisibility } from '@/db/enum/story.enum';
import { AdminStats, Percentage, PlayerStats } from './stats.types';

/** Ventana de "esta semana": los últimos 7 días. */
const WEEK_INTERVAL = `interval '7 days'`;

/** `part / total` como porcentaje entero; 0 si no hay total. */
export const percent = (part: number, total: number): Percentage =>
  total > 0 ? Math.round((part / total) * 100) : 0;

/** Postgres devuelve `count`/`sum` como string (bigint): siempre a número. */
const num = (value: unknown) => Number(value ?? 0);

/**
 * Estadísticas reales para los dashboards, calculadas con SQL sobre las
 * tablas de la trivia (`game`, `game_session`, `player_answer`) y de las
 * historietas. Solo cuentan las historietas publicadas.
 */
@Injectable()
export class StatsService {
  constructor(@InjectDataSource() private readonly db: DataSource) {}

  /** Filas de una consulta (los valores llegan como los da Postgres). */
  private rows(sql: string, params?: unknown[]): Promise<Record<string, unknown>[]> {
    return this.db.query(sql, params);
  }

  async player(userId: string): Promise<PlayerStats> {
    const [[user], [trivia], levels, [stories]] = await Promise.all([
      this.rows(
        `SELECT "score", "level", "gamesPlayed", "gamesWon", "currentStreak"
         FROM "user" WHERE "id" = $1`,
        [userId],
      ),
      this.rows(
        `SELECT count(*) AS answered,
                count(*) FILTER (WHERE pa."isCorrect") AS correct,
                count(DISTINCT q."category_id") AS categories
         FROM "player_answer" pa
         JOIN "game_session" gs ON gs."id" = pa."game_session_id"
         JOIN "question" q ON q."id" = pa."question_id"
         WHERE gs."user_id" = $1`,
        [userId],
      ),
      this.rows(
        `SELECT c."level" AS level, count(*) AS answered,
                count(*) FILTER (WHERE pa."isCorrect") AS correct
         FROM "player_answer" pa
         JOIN "game_session" gs ON gs."id" = pa."game_session_id"
         JOIN "question" q ON q."id" = pa."question_id"
         JOIN "category_question" c ON c."id" = q."category_id"
         WHERE gs."user_id" = $1
         GROUP BY c."level"
         ORDER BY c."level"`,
        [userId],
      ),
      this.rows(
        `SELECT count(*) AS played,
                coalesce(sum(sp."panelsWritten"), 0) AS panels,
                coalesce(sum(sp."totalScore"), 0) AS score
         FROM "story_participant" sp
         JOIN "story" s ON s."id" = sp."story_id"
         WHERE sp."user_id" = $1 AND s."visibility" = $2`,
        [userId, StoryVisibility.PUBLISHED],
      ),
    ]);
    if (!user) throw new NotFoundException('User not found');

    const gamesPlayed = num(user.gamesPlayed);
    const gamesWon = num(user.gamesWon);
    const answered = num(trivia.answered);
    const correct = num(trivia.correct);
    const panels = num(stories.panels);
    const storyScore = num(stories.score);

    return {
      score: num(user.score),
      level: user.level as Level,
      gamesPlayed,
      gamesWon,
      currentStreak: num(user.currentStreak),
      winRate: percent(gamesWon, gamesPlayed),
      trivia: {
        questionsAnswered: answered,
        correctAnswers: correct,
        accuracy: percent(correct, answered),
        categoriesPracticed: num(trivia.categories),
      },
      levels: levels.map((row) => ({
        level: row.level as Level,
        answered: num(row.answered),
        accuracy: percent(num(row.correct), num(row.answered)),
      })),
      stories: {
        played: num(stories.played),
        panelsWritten: panels,
        totalScore: storyScore,
        averagePanelScore: panels > 0 ? Math.round((storyScore / panels) * 10) / 10 : 0,
      },
    };
  }

  async admin(): Promise<AdminStats> {
    const [[users], [content], [trivia], [stories], levelRows, categoryRows] = await Promise.all([
      this.rows(
        `SELECT count(*) AS total,
                count(*) FILTER (WHERE "userRole" = $1) AS players,
                count(*) FILTER (WHERE "userRole" = $2) AS admins,
                count(*) FILTER (WHERE "createdAt" >= now() - ${WEEK_INTERVAL}) AS new_this_week,
                (SELECT count(*) FROM (
                   SELECT "user_id" FROM "game_session" WHERE "createdAt" >= now() - ${WEEK_INTERVAL}
                   UNION
                   SELECT "user_id" FROM "story_participant" WHERE "createdAt" >= now() - ${WEEK_INTERVAL}
                 ) active) AS active_this_week
         FROM "user"`,
        [UserRoles.PLAYER, UserRoles.ADMIN],
      ),
      this.rows(
        `SELECT (SELECT count(*) FROM "question") AS questions,
                (SELECT count(*) FROM "category_question") AS categories`,
      ),
      this.rows(
        `SELECT (SELECT count(*) FROM "game") AS games,
                (SELECT count(*) FROM "player_answer") AS answered,
                (SELECT count(*) FROM "player_answer" WHERE "isCorrect") AS correct,
                (SELECT coalesce(sum("gamesWon"), 0) FROM "user") AS won,
                (SELECT coalesce(sum("gamesPlayed"), 0) FROM "user") AS played`,
      ),
      this.rows(
        `SELECT count(*) AS total,
                count(*) FILTER (WHERE "visibility" = $1) AS published,
                count(*) FILTER (WHERE "visibility" = $2) AS removed,
                (SELECT count(*) FROM "story_panel") AS panels
         FROM "story"`,
        [StoryVisibility.PUBLISHED, StoryVisibility.REMOVED],
      ),
      this.rows(
        `SELECT level, sum(trivia) AS trivia, sum(stories) AS stories FROM (
           SELECT "difficulty"::text AS level, count(*) AS trivia, 0 AS stories
           FROM "game" GROUP BY "difficulty"
           UNION ALL
           SELECT "level"::text AS level, 0 AS trivia, count(*) AS stories
           FROM "story" WHERE "visibility" = $1 GROUP BY "level"
         ) usage
         GROUP BY level ORDER BY level`,
        [StoryVisibility.PUBLISHED],
      ),
      this.rows(
        `SELECT c."descriptionCategory" AS category, count(*) AS answers
         FROM "player_answer" pa
         JOIN "question" q ON q."id" = pa."question_id"
         JOIN "category_question" c ON c."id" = q."category_id"
         GROUP BY c."id", c."descriptionCategory"
         ORDER BY answers DESC, category`,
      ),
    ]);

    const players = num(users.players);
    const activeThisWeek = num(users.active_this_week);
    const answered = num(trivia.answered);

    const usage = levelRows.map((row) => ({
      level: row.level as Level,
      triviaGames: num(row.trivia),
      stories: num(row.stories),
    }));
    const usageTotal = usage.reduce((sum, row) => sum + row.triviaGames + row.stories, 0);
    const answersTotal = categoryRows.reduce((sum, row) => sum + num(row.answers), 0);

    return {
      users: {
        total: num(users.total),
        players,
        admins: num(users.admins),
        activeThisWeek,
        activeRate: Math.min(percent(activeThisWeek, players), 100),
        newThisWeek: num(users.new_this_week),
      },
      content: { questions: num(content.questions), categories: num(content.categories) },
      trivia: {
        games: num(trivia.games),
        questionsAnswered: answered,
        accuracy: percent(num(trivia.correct), answered),
        winRate: percent(num(trivia.won), num(trivia.played)),
      },
      stories: {
        total: num(stories.total),
        published: num(stories.published),
        removed: num(stories.removed),
        panels: num(stories.panels),
      },
      levelUsage: usage.map((row) => ({
        ...row,
        percentage: percent(row.triviaGames + row.stories, usageTotal),
      })),
      categoryDistribution: categoryRows.map((row) => ({
        category: String(row.category),
        answers: num(row.answers),
        percentage: percent(num(row.answers), answersTotal),
      })),
    };
  }
}
