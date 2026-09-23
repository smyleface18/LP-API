import { MatchDto, MatchStatus, ModeMatch, OptionDto, QuestionDto } from './domain/match.interface';
import { BadRequestException, Injectable, UnauthorizedException } from '@nestjs/common';
import { Match } from './domain/match.entity';
import { CacheService } from '@/common/src/cache/cache.service';
import { Level } from '@/db/enum/question.enum';
import { QuestionService } from '@/modules/question/question.service';
import { CacheKeys } from '@/common/src/cache/cache-key';
import { MatchNotFoundError } from './domain/exceptions/match-not-found.error';
import { UniqueNamesAdapter } from '@/common/src/unique-names/unique-names.adapter';
import { v4 } from 'uuid';
import { Question, QuestionOption, User } from '@/db/entities';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { AnswerProcessResultDto } from '../types';
import { MatchResultsService } from './match-results.service';

@Injectable()
export class MatchService {
  // Cola de operaciones por sala: cada mutación hace get -> modificar -> set sobre
  // la cache, así que dos operaciones concurrentes en la misma sala (ej. dos
  // jugadores respondiendo a la vez) se pisarían y una se perdería. Solo
  // serializa dentro de este proceso; con varias instancias haría falta un
  // lock distribuido en Redis.
  private readonly roomLocks = new Map<string, Promise<unknown>>();

  constructor(
    private readonly cache: CacheService,
    private readonly questionService: QuestionService,
    private readonly uniqueNames: UniqueNamesAdapter,
    private readonly eventEmitter: EventEmitter2,
    private readonly matchResults: MatchResultsService,
  ) {}

  async createMatch(difficulty: Level, mode: ModeMatch, owner: User): Promise<Match> {
    const questions = await this.questionService.getRandomQuestions(difficulty);

    let roomId = '';
    switch (mode) {
      case ModeMatch.MULTIPLAYER:
        roomId = this.uniqueNames.NamesGenerator();
        break;
      case ModeMatch.SINGLEPLAYER:
        roomId = v4();
        break;
      default:
        roomId = v4();
    }

    const match = new Match(roomId, difficulty, mode, questions, owner);

    await this.saveMatch(match);
    return match;
  }

  async joinMatch(
    roomId: string,
    userId: string,
    username: string = 'Anonymous',
    level: Level = Level.A1,
    totalScore: number = 0,
    avatar?: string,
  ): Promise<Match> {
    return this.withRoomLock(roomId, async () => {
      const match = await this.getMatch(roomId);

      match.addPlayer(userId, username, level, totalScore, avatar);
      await this.saveMatch(match);

      return match;
    });
  }

  async disconnectUser(userId: string, roomId: string): Promise<Match> {
    return this.withRoomLock(roomId, async () => {
      const match = await this.getMatch(roomId);

      match.disconnectPlayer(userId);
      await this.saveMatch(match);

      return match;
    });
  }

  async finishMatch(roomId: string) {
    return this.withRoomLock(roomId, async () => {
      const match = await this.getMatch(roomId);

      if (!match.areResultsPersisted()) {
        const totals = await this.matchResults.persist(match);
        match.applyTotalScores(totals);
        match.markResultsPersisted();
        await this.saveMatch(match);
      }

      return match.getResults();
    });
  }

  async getMatch(roomId: string): Promise<Match> {
    const match = await this.cache.get<Match>(CacheKeys.match(roomId));
    if (!match) {
      throw new MatchNotFoundError(roomId);
    }

    return Match.fromPersistence(match);
  }

  async nextQuestion(roomId: string): Promise<QuestionDto | null> {
    return this.withRoomLock(roomId, () => this.nextQuestionUnlocked(roomId));
  }

  private async nextQuestionUnlocked(roomId: string): Promise<QuestionDto | null> {
    const match = await this.getMatch(roomId);
    const question = match.sendNextQuestion();

    if (match.isRoomEmpty()) {
      this.eventEmitter.emit('game.finished', {
        roomId,
      });
      return null;
    }

    if (question) {
      this.eventEmitter.emit('question.started', {
        roomId: match.getRoomId(),
        timeLimit: question.timeLimit,
      });
    }

    await this.saveMatch(match);

    return question ? this.toQuestionDto(question) : null;
  }

  async startMatch(roomId: string, userId: string): Promise<MatchStatus> {
    return this.withRoomLock(roomId, () => this.startMatchUnlocked(roomId, userId));
  }

  private async startMatchUnlocked(roomId: string, userId: string): Promise<MatchStatus> {
    const match = await this.getMatch(roomId);

    if (match.getOwner().id != userId) {
      throw new UnauthorizedException(
        'you cannot start the partina because you are not the creator of the game',
      );
    }

    if (match.getStatus() != MatchStatus.WAITING) {
      throw new BadRequestException('The game has already started.');
    }

    match.start();

    await this.saveMatch(match);

    return match.getStatus();
  }

  async resetForRematch(roomId: string): Promise<Match> {
    return this.withRoomLock(roomId, async () => {
      const match = await this.getMatch(roomId);
      if (match.getStatus() !== MatchStatus.FINISHED) {
        throw new BadRequestException('The game is not finished yet.');
      }

      match.resetForRematch();
      await this.saveMatch(match);
      return match;
    });
  }

  async finishCurrentQuestion(roomId: string): Promise<Match> {
    return this.withRoomLock(roomId, async () => {
      const match = await this.getMatch(roomId);
      match.finishCurrentQuestion();
      await this.saveMatch(match);
      return match;
    });
  }

  async hasNextQuestion(roomId: string): Promise<boolean> {
    const match = await this.getMatch(roomId);
    return match.hasNextQuestion();
  }

  async processAnswer(
    roomId: string,
    questionId: string,
    answerId: string,
    userId: string,
  ): Promise<AnswerProcessResultDto> {
    return this.withRoomLock(roomId, async () => {
      const match = await this.getMatch(roomId);

      if (!match.hasPlayer(userId)) {
        throw new BadRequestException('You are not a player in this match');
      }

      // Solo se acepta respuesta para la pregunta activa: la cola de timeout
      // pasa el match a BETWEEN_QUESTIONS al vencer el timeLimit, así que esto
      // también rechaza respuestas fuera de tiempo o a preguntas pasadas/futuras.
      const activeQuestion = match.getActiveQuestion();
      if (!activeQuestion || activeQuestion.id !== questionId) {
        throw new BadRequestException('This question is not accepting answers');
      }

      if (match.hasAnswered(questionId, userId)) {
        throw new BadRequestException('You already answered this question');
      }

      const answer = activeQuestion.options.find((op) => op.id == answerId);
      if (!answer) {
        throw new BadRequestException('Invalid answerId');
      }

      const correctAnswers = activeQuestion.options.filter((op) => op.isCorrect);
      match.recordAnswer(questionId, userId, answer.id, answer.isCorrect);
      match.addScore(userId, answer.isCorrect ? 100 : 0);
      await this.saveMatch(match);

      return {
        isCorrect: answer.isCorrect,
        correctAnswer: correctAnswers,
        playersScores: match.getPlayersWithInfo(),
      };
    });
  }

  getMatchDto(match: Match): MatchDto {
    return {
      roomId: match.getRoomId(),
      difficulty: match.getDifficulty(),
      mode: match.getMode(),
      status: match.getStatus(),
      currentQuestionIndex: match.getcurrentQuestionIndex(),
      players: match.getPlayersWithInfo(),
      questions: match.getQuestions().map((q) => this.toQuestionDto(q)),
    };
  }

  private async withRoomLock<T>(roomId: string, fn: () => Promise<T>): Promise<T> {
    const previous = this.roomLocks.get(roomId) ?? Promise.resolve();
    const run = previous.then(fn);
    // La cola sigue aunque esta operación falle.
    const tail = run.catch(() => undefined);
    this.roomLocks.set(roomId, tail);

    try {
      return await run;
    } finally {
      if (this.roomLocks.get(roomId) === tail) this.roomLocks.delete(roomId);
    }
  }

  private async saveMatch(match: Match): Promise<void> {
    return await this.cache.set(CacheKeys.match(match.getRoomId()), match.toPersistence(), 900000); // todo: implement definition of ttl by now is 15 minutes
  }

  private toQuestionDto(question: Question): QuestionDto {
    const options: OptionDto[] = question.options.map((option) => {
      return this.toOptionDto(option);
    });

    return {
      id: question.id,
      contentType: question.contentType,
      text: question.text,
      media: question.media,
      category: question.category,
      categoryId: question.categoryId,
      timeLimit: question.timeLimit,
      options: options,
    };
  }

  private toOptionDto(option: QuestionOption): OptionDto {
    return {
      id: option.id,
      contentType: option.contentType,
      text: option.text,
      media: option.media,
    };
  }
}
