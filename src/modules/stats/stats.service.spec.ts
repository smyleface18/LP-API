import { NotFoundException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { percent, StatsService } from './stats.service';

/**
 * El SQL se prueba contra el Postgres local con `test/stats-smoke.ts`; acá se
 * prueba cómo se arman los resultados (Postgres devuelve los count como string).
 */
describe('StatsService', () => {
  let query: jest.Mock;
  let service: StatsService;

  beforeEach(() => {
    query = jest.fn();
    service = new StatsService({ query } as unknown as DataSource);
  });

  it('percent rounds and never divides by zero', () => {
    expect(percent(1, 3)).toBe(33);
    expect(percent(2, 3)).toBe(67);
    expect(percent(5, 0)).toBe(0);
  });

  describe('player', () => {
    const mockRows = (user: object | undefined) =>
      query
        .mockResolvedValueOnce(user ? [user] : [])
        .mockResolvedValueOnce([{ answered: '20', correct: '15', categories: '2' }])
        .mockResolvedValueOnce([
          { level: 'A1', answered: '12', correct: '11' },
          { level: 'A2', answered: '8', correct: '4' },
        ])
        .mockResolvedValueOnce([{ played: '3', panels: '7', score: '600' }]);

    it('combines the user counters, the trivia answers and the stories', async () => {
      mockRows({ score: 900, level: 'A2', gamesPlayed: 4, gamesWon: 3, currentStreak: 2 });

      expect(await service.player('alice')).toEqual({
        score: 900,
        level: 'A2',
        gamesPlayed: 4,
        gamesWon: 3,
        currentStreak: 2,
        winRate: 75,
        trivia: { questionsAnswered: 20, correctAnswers: 15, accuracy: 75, categoriesPracticed: 2 },
        levels: [
          { level: 'A1', answered: 12, accuracy: 92 },
          { level: 'A2', answered: 8, accuracy: 50 },
        ],
        stories: { played: 3, panelsWritten: 7, totalScore: 600, averagePanelScore: 85.7 },
      });
      // Todas las consultas son del usuario que pide.
      for (const [, params] of query.mock.calls as [string, unknown[]][]) {
        expect(params[0]).toBe('alice');
      }
    });

    it('answers 404 for an unknown user', async () => {
      mockRows(undefined);
      await expect(service.player('ghost')).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  it('builds the admin stats with percentages per level and per category', async () => {
    query
      .mockResolvedValueOnce([
        { total: '10', players: '8', admins: '2', new_this_week: '1', active_this_week: '4' },
      ])
      .mockResolvedValueOnce([{ questions: '50', categories: '5' }])
      .mockResolvedValueOnce([
        { games: '30', answered: '200', correct: '150', won: '12', played: '40' },
      ])
      .mockResolvedValueOnce([{ total: '7', published: '6', removed: '1', panels: '40' }])
      .mockResolvedValueOnce([
        { level: 'A1', trivia: '20', stories: '4' },
        { level: 'B1', trivia: '10', stories: '2' },
      ])
      .mockResolvedValueOnce([
        { category: 'Animals', answers: '150' },
        { category: 'Food', answers: '50' },
      ]);

    expect(await service.admin()).toEqual({
      users: {
        total: 10,
        players: 8,
        admins: 2,
        activeThisWeek: 4,
        activeRate: 50,
        newThisWeek: 1,
      },
      content: { questions: 50, categories: 5 },
      trivia: { games: 30, questionsAnswered: 200, accuracy: 75, winRate: 30 },
      stories: { total: 7, published: 6, removed: 1, panels: 40 },
      levelUsage: [
        { level: 'A1', triviaGames: 20, stories: 4, percentage: 67 },
        { level: 'B1', triviaGames: 10, stories: 2, percentage: 33 },
      ],
      categoryDistribution: [
        { category: 'Animals', answers: 150, percentage: 75 },
        { category: 'Food', answers: 50, percentage: 25 },
      ],
    });
  });

  it('caps the active rate at 100 (admins can be active too)', async () => {
    query
      .mockResolvedValueOnce([
        { total: '3', players: '1', admins: '2', new_this_week: '0', active_this_week: '3' },
      ])
      .mockResolvedValueOnce([{ questions: '0', categories: '0' }])
      .mockResolvedValueOnce([{ games: '0', answered: '0', correct: '0', won: '0', played: '0' }])
      .mockResolvedValueOnce([{ total: '0', published: '0', removed: '0', panels: '0' }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);

    const stats = await service.admin();
    expect(stats.users.activeRate).toBe(100);
    expect(stats.trivia).toEqual({ games: 0, questionsAnswered: 0, accuracy: 0, winRate: 0 });
  });
});
