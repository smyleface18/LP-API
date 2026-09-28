import { Question, User } from '@/db/entities';
import { Level } from '@/db/enum/question.enum';
import { Match } from './match.entity';
import { ModeMatch } from './match.interface';
import { determineWinners } from './match-outcome';

const questions = ['q1', 'q2', 'q3', 'q4'].map(
  (id) => ({ id, timeLimit: 10, options: [] }) as unknown as Question,
);
const owner = { id: 'u1', username: 'owner', level: Level.A1, score: 0 } as User;

const newMatch = (players: string[] = []) => {
  const match = new Match('room', Level.A1, ModeMatch.MULTIPLAYER, questions, owner);
  players.forEach((id) => match.addPlayer(id, id, Level.A1, 0));
  return match;
};

/** Registra respuestas de un jugador: `correct` de las primeras preguntas acertadas. */
const answer = (match: Match, userId: string, correct: number, answered = questions.length) => {
  questions.slice(0, answered).forEach((q, i) => {
    const isCorrect = i < correct;
    match.recordAnswer(q.id, userId, 'opt', isCorrect, 0, isCorrect ? 1000 : 0);
    match.addScore(userId, isCorrect ? 1000 : 0);
  });
};

describe('determineWinners', () => {
  describe('multiplayer', () => {
    it('the top score wins', () => {
      const match = newMatch(['u2', 'u3']);
      answer(match, 'u1', 3);
      answer(match, 'u2', 1);
      answer(match, 'u3', 0);

      expect(determineWinners(match)).toEqual(new Set(['u1']));
    });

    it('a tie for first place makes every tied player a winner', () => {
      const match = newMatch(['u2', 'u3']);
      answer(match, 'u1', 2);
      answer(match, 'u2', 2);
      answer(match, 'u3', 1);

      expect(determineWinners(match)).toEqual(new Set(['u1', 'u2']));
    });

    it('nobody wins if nobody scored', () => {
      const match = newMatch(['u2']);

      expect(determineWinners(match)).toEqual(new Set());
    });

    it('a player who left cannot win, the best remaining one does', () => {
      const match = newMatch(['u2']);
      answer(match, 'u1', 4);
      answer(match, 'u2', 1);
      match.leave('u1');

      expect(determineWinners(match)).toEqual(new Set(['u2']));
    });

    it('a disconnected (not left) player can still win', () => {
      const match = newMatch(['u2']);
      answer(match, 'u1', 4);
      match.disconnectPlayer('u1');

      expect(determineWinners(match)).toEqual(new Set(['u1']));
    });
  });

  describe('solo', () => {
    it('wins answering at least half of the questions right', () => {
      const match = newMatch();
      answer(match, 'u1', 2);

      expect(determineWinners(match)).toEqual(new Set(['u1']));
    });

    it('loses below half, including unanswered questions', () => {
      const match = newMatch();
      answer(match, 'u1', 1, 2);

      expect(determineWinners(match)).toEqual(new Set());
    });

    it('loses if the player left', () => {
      const match = newMatch();
      answer(match, 'u1', 4);
      match.leave('u1');

      expect(determineWinners(match)).toEqual(new Set());
    });
  });

  it('keeps the match mode when restored from Redis', () => {
    const match = new Match('room', Level.A1, ModeMatch.SINGLEPLAYER, questions, owner);

    const restored = Match.fromPersistence(JSON.parse(JSON.stringify(match.toPersistence())));

    expect(restored.getMode()).toBe(ModeMatch.SINGLEPLAYER);
  });
});
