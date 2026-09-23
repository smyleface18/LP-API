import { MatchDto, MatchStatus, ModeMatch, OptionDto, QuestionDto } from './domain/match.interface';
import { BadRequestException, Injectable, UnauthorizedException } from '@nestjs/common';
import { Match } from './domain/match.entity';
import { Level } from '@/db/enum/question.enum';
import { QuestionService } from '@/modules/question/question.service';
import { MatchNotFoundError } from './domain/exceptions/match-not-found.error';
import { UniqueNamesAdapter } from '@/common/src/unique-names/unique-names.adapter';
import { v4 } from 'uuid';
import { LockHandle } from '@/common/src/redis/redis-lock.service';
import { Question, QuestionOption, User } from '@/db/entities';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { AnswerProcessResultDto } from '../types';
import { MatchResultsService } from './match-results.service';
import { MatchStore } from './match.store';

// Reintentos si el nombre de sala generado ya está en uso por otra partida.
const MAX_ROOM_ID_ATTEMPTS = 5;

export interface RematchVote {
  accepted: number;
  total: number;
  /** Presente solo cuando votaron todos y el match se reinició. */
  rematch?: Match;
}

@Injectable()
export class MatchService {
  // Cada mutación hace get -> modificar -> save sobre Redis. Para que dos
  // operaciones concurrentes en la misma sala (ej. dos jugadores respondiendo a
  // la vez, aunque estén conectados a instancias distintas de la API) no se
  // pisen, todas pasan por store.withRoomLock: un lock distribuido en Redis.
  constructor(
    private readonly store: MatchStore,
    private readonly questionService: QuestionService,
    private readonly uniqueNames: UniqueNamesAdapter,
    private readonly eventEmitter: EventEmitter2,
    private readonly matchResults: MatchResultsService,
  ) {}

  async createMatch(difficulty: Level, mode: ModeMatch, owner: User): Promise<Match> {
    const questions = await this.questionService.getRandomQuestions(difficulty);

    for (let attempt = 0; attempt < MAX_ROOM_ID_ATTEMPTS; attempt++) {
      const roomId = mode === ModeMatch.MULTIPLAYER ? this.uniqueNames.NamesGenerator() : v4();
      const match = new Match(roomId, difficulty, mode, questions, owner);

      // create() no pisa una partida existente con el mismo nombre de sala.
      if (await this.store.create(match)) return match;
    }

    throw new BadRequestException('Could not allocate a room, try again');
  }

  async joinMatch(
    roomId: string,
    userId: string,
    username: string = 'Anonymous',
    level: Level = Level.A1,
    totalScore: number = 0,
    avatar?: string,
  ): Promise<Match> {
    return this.store.withRoomLock(roomId, async (lock) => {
      const match = await this.getMatch(roomId);

      match.addPlayer(userId, username, level, totalScore, avatar);
      await this.store.save(match, lock);

      return match;
    });
  }

  async disconnectUser(userId: string, roomId: string): Promise<Match> {
    return this.store.withRoomLock(roomId, async (lock) => {
      const match = await this.getMatch(roomId);

      match.disconnectPlayer(userId);
      await this.store.save(match, lock);

      return match;
    });
  }

  async finishMatch(roomId: string) {
    return this.store.withRoomLock(roomId, async (lock) => {
      const match = await this.getMatch(roomId);

      if (!match.areResultsPersisted()) {
        const totals = await this.matchResults.persist(match);
        match.applyTotalScores(totals);
        match.markResultsPersisted();
        await this.store.save(match, lock);
      }

      return match.getResults();
    });
  }

  async getMatch(roomId: string): Promise<Match> {
    const match = await this.store.get(roomId);
    if (!match) {
      throw new MatchNotFoundError(roomId);
    }

    return Match.fromPersistence(match);
  }

  async nextQuestion(roomId: string): Promise<QuestionDto | null> {
    return this.store.withRoomLock(roomId, (lock) => this.nextQuestionLocked(roomId, lock));
  }

  private async nextQuestionLocked(roomId: string, lock: LockHandle): Promise<QuestionDto | null> {
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

    await this.store.save(match, lock);

    return question ? this.toQuestionDto(question) : null;
  }

  async startMatch(roomId: string, userId: string): Promise<MatchStatus> {
    return this.store.withRoomLock(roomId, (lock) => this.startMatchLocked(roomId, userId, lock));
  }

  private async startMatchLocked(
    roomId: string,
    userId: string,
    lock: LockHandle,
  ): Promise<MatchStatus> {
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

    await this.store.save(match, lock);

    return match.getStatus();
  }

  /**
   * Registra el voto de revancha del jugador. Los votos viven en el estado del
   * match (Redis), no en memoria del gateway, para que cuenten aunque cada
   * jugador esté conectado a una instancia distinta.
   */
  async requestRematch(roomId: string, userId: string): Promise<RematchVote> {
    return this.store.withRoomLock(roomId, async (lock) => {
      const match = await this.getMatch(roomId);
      if (match.getStatus() !== MatchStatus.FINISHED) {
        throw new BadRequestException('The game is not finished yet.');
      }
      if (!match.hasPlayer(userId)) {
        throw new BadRequestException('You are not a player in this match');
      }

      match.addRematchVote(userId);
      const accepted = match.getRematchVotes();
      const total = match.getPlayersCount();

      if (accepted < total) {
        await this.store.save(match, lock);
        return { accepted, total };
      }

      match.resetForRematch();
      await this.store.save(match, lock);
      return { accepted, total, rematch: match };
    });
  }

  async finishCurrentQuestion(roomId: string): Promise<Match> {
    return this.store.withRoomLock(roomId, async (lock) => {
      const match = await this.getMatch(roomId);
      match.finishCurrentQuestion();
      await this.store.save(match, lock);
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
    return this.store.withRoomLock(roomId, async (lock) => {
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
      await this.store.save(match, lock);

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
