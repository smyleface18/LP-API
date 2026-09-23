import {
  GameStateSnapshot,
  MatchDto,
  MatchStatus,
  ModeMatch,
  OptionDto,
  QuestionDto,
} from './domain/match.interface';
import { BadRequestException, Injectable, UnauthorizedException } from '@nestjs/common';
import { Match } from './domain/match.entity';
import { Level } from '@/db/enum/question.enum';
import { QuestionService } from '@/modules/question/question.service';
import { MatchNotFoundError } from './domain/exceptions/match-not-found.error';
import { UniqueNamesAdapter } from '@/common/src/unique-names/unique-names.adapter';
import { v4 } from 'uuid';
import { LockHandle } from '@/common/src/redis/redis-lock.service';
import { Question, QuestionOption, User } from '@/db/entities';
import { AnswerProcessResultDto } from '../types';
import { MatchResultsService } from './match-results.service';
import { MatchStore } from './match.store';
import { MediaService } from '@/modules/media/media.service';
import {
  ANSWER_GRACE_MS,
  MIN_QUESTION_LEAD_MS,
  QUESTION_LEAD_MS,
  REVEAL_MS,
  START_COUNTDOWN_MS,
} from '../game-timing';
import { calculatePoints } from '../game-scoring';

// Reintentos si el nombre de sala generado ya está en uso por otra partida.
const MAX_ROOM_ID_ATTEMPTS = 5;

export type PublishResult =
  | { kind: 'stale' }
  | { kind: 'finished' }
  | {
      kind: 'question';
      seq: number;
      question: QuestionDto;
      questionNumber: number;
      totalQuestions: number;
      startsAt: number;
      endsAt: number;
    };

export type CloseResult =
  | { kind: 'stale' }
  /** Cierre anticipado pedido pero todavía falta que respondan jugadores conectados. */
  | { kind: 'pending' }
  /** El job se disparó antes de tiempo (skew de reloj entre instancias): reprogramar. */
  | { kind: 'early'; seq: number; dueAt: number }
  | { kind: 'closed'; seq: number; questionId: string; hasNext: boolean; nextPlannedAt: number };

export interface AnswerOutcome extends AnswerProcessResultDto {
  points: number;
  /** Todos los conectados respondieron: se puede cerrar la pregunta ya. */
  allAnswered: boolean;
  /** Fase de la pregunta respondida, para pedir su cierre anticipado. */
  seq: number;
}

export interface DisconnectOutcome {
  match: Match;
  /** Si hay una pregunta activa y los que quedan conectados ya respondieron todos. */
  allAnswered: boolean;
  seq: number;
}

export interface StartPlan {
  seq: number;
  /** Cuándo publicar la primera pregunta. */
  publishAt: number;
  /** Cuándo se mostrará (publishAt + antelación). */
  firstQuestionAt: number;
}

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
    private readonly matchResults: MatchResultsService,
    private readonly media: MediaService,
  ) {}

  async createMatch(difficulty: Level, mode: ModeMatch, owner: User): Promise<Match> {
    const questions = await this.questionService.getRandomQuestions(difficulty);
    if (questions.length === 0) {
      throw new BadRequestException('There are no questions available for this level yet');
    }

    for (let attempt = 0; attempt < MAX_ROOM_ID_ATTEMPTS; attempt++) {
      const roomId = mode === ModeMatch.MULTIPLAYER ? this.uniqueNames.NamesGenerator() : v4();
      const match = new Match(roomId, difficulty, mode, questions, owner);

      // create() no pisa una partida existente con el mismo nombre de sala.
      if (await this.store.create(match)) {
        await this.store.setUserRoom(owner.id, roomId);
        return match;
      }
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
      await this.store.setUserRoom(userId, roomId);

      return match;
    });
  }

  /** Corte de conexión (red, app en segundo plano): puede volver con resume(). */
  async disconnectUser(userId: string, roomId: string): Promise<DisconnectOutcome> {
    return this.store.withRoomLock(roomId, async (lock) => {
      const match = await this.getMatch(roomId);

      match.disconnectPlayer(userId);
      await this.store.save(match, lock);

      return { match, allAnswered: match.haveAllConnectedAnswered(), seq: match.getSeq() };
    });
  }

  /** Salida explícita de la sala (leaveRoom). */
  async leaveMatch(userId: string, roomId: string): Promise<DisconnectOutcome> {
    return this.store.withRoomLock(roomId, async (lock) => {
      const match = await this.getMatch(roomId);

      match.leave(userId);
      await this.store.save(match, lock);
      await this.store.clearUserRoom(userId, roomId);

      return { match, allAnswered: match.haveAllConnectedAnswered(), seq: match.getSeq() };
    });
  }

  /**
   * Reincorpora a un usuario que se reconecta a la sala en la que estaba (si
   * sigue existiendo y es jugador) y devuelve el estado completo para que su
   * cliente reconstruya la pantalla. null si no tiene partida a la que volver.
   */
  async resume(userId: string): Promise<GameStateSnapshot | null> {
    const roomId = await this.store.getUserRoom(userId);
    if (!roomId) return null;

    try {
      return await this.store.withRoomLock(roomId, async (lock) => {
        const match = await this.getMatch(roomId);
        if (!match.hasPlayer(userId)) return null;

        match.reconnectPlayer(userId);
        await this.store.save(match, lock);

        const snapshot = this.toSnapshot(match, userId);
        if (snapshot.question) snapshot.question = await this.signQuestionDto(snapshot.question);
        return snapshot;
      });
    } catch (error) {
      if (error instanceof MatchNotFoundError) {
        await this.store.clearUserRoom(userId, roomId);
        return null;
      }
      throw error;
    }
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

  /**
   * Publica la siguiente pregunta con una ventana absoluta en hora del servidor.
   * `plannedAt` es cuándo debía correr este paso según la línea de tiempo (no
   * cuándo corrió el job): anclar ahí evita que los atrasos del scheduler se
   * acumulen pregunta tras pregunta.
   */
  async publishNextQuestion(
    roomId: string,
    seq: number,
    plannedAt: number,
    now: number,
  ): Promise<PublishResult> {
    return this.store.withRoomLock(roomId, async (lock) => {
      const match = await this.getMatch(roomId);
      const status = match.getStatus();
      if (
        match.getSeq() !== seq ||
        (status !== MatchStatus.STARTING && status !== MatchStatus.BETWEEN_QUESTIONS)
      ) {
        return { kind: 'stale' };
      }

      if (!match.hasNextQuestion() || match.isRoomEmpty()) {
        match.finish();
        await this.store.save(match, lock);
        return { kind: 'finished' };
      }

      // Si el scheduler se atrasó, igual se deja un mínimo de antelación para
      // que la pregunta llegue a todos antes de mostrarse.
      const startsAt = Math.max(plannedAt + QUESTION_LEAD_MS, now + MIN_QUESTION_LEAD_MS);
      const nextQuestion = match.getQuestions()[match.getcurrentQuestionIndex()];
      const endsAt = startsAt + nextQuestion.timeLimit * 1000;
      const question = match.sendNextQuestion(startsAt, endsAt)!;

      await this.store.save(match, lock);

      return {
        kind: 'question',
        seq: match.getSeq(),
        question: await this.signQuestionDto(this.toQuestionDto(question)),
        questionNumber: match.getcurrentQuestionIndex(),
        totalQuestions: match.getQuestions().length,
        startsAt,
        endsAt,
      };
    });
  }

  /**
   * Cierra la pregunta activa. Por defecto, cuando vence su ventana (endsAt +
   * gracia). Con `whenAllAnswered` la cierra ya si todos los jugadores
   * conectados respondieron; la condición se verifica acá, bajo el lock, así
   * que no importa cuántas respuestas concurrentes lo pidan.
   */
  async closeQuestion(
    roomId: string,
    seq: number,
    now: number,
    { whenAllAnswered = false }: { whenAllAnswered?: boolean } = {},
  ): Promise<CloseResult> {
    return this.store.withRoomLock(roomId, async (lock) => {
      const match = await this.getMatch(roomId);
      const window = match.getQuestionWindow();
      const question = match.getActiveQuestion();
      if (match.getSeq() !== seq || !window || !question) {
        return { kind: 'stale' };
      }

      let closeAt = window.endsAt + ANSWER_GRACE_MS;
      if (whenAllAnswered) {
        if (!match.haveAllConnectedAnswered()) return { kind: 'pending' };
        closeAt = Math.min(closeAt, now);
      } else if (now < closeAt) {
        return { kind: 'early', seq, dueAt: closeAt };
      }

      match.finishCurrentQuestion();
      const hasNext = match.hasNextQuestion();
      // Anclado al cierre planeado (o al anticipado), no a cuándo corrió el job.
      const nextPlannedAt = closeAt + REVEAL_MS;
      match.setNextQuestionAt(hasNext ? nextPlannedAt + QUESTION_LEAD_MS : null);
      await this.store.save(match, lock);

      return {
        kind: 'closed',
        seq: match.getSeq(),
        questionId: question.id,
        hasNext,
        nextPlannedAt,
      };
    });
  }

  async startMatch(roomId: string, userId: string, now: number = Date.now()): Promise<StartPlan> {
    return this.store.withRoomLock(roomId, (lock) =>
      this.startMatchLocked(roomId, userId, now, lock),
    );
  }

  private async startMatchLocked(
    roomId: string,
    userId: string,
    now: number,
    lock: LockHandle,
  ): Promise<StartPlan> {
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
    const publishAt = now + START_COUNTDOWN_MS;
    const firstQuestionAt = publishAt + QUESTION_LEAD_MS;
    match.setNextQuestionAt(firstQuestionAt);

    await this.store.save(match, lock);

    return { seq: match.getSeq(), publishAt, firstQuestionAt };
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

  async processAnswer(
    roomId: string,
    questionId: string,
    answerId: string,
    userId: string,
    receivedAt: number = Date.now(),
  ): Promise<AnswerOutcome> {
    return this.store.withRoomLock(roomId, async (lock) => {
      const match = await this.getMatch(roomId);

      if (!match.hasPlayer(userId)) {
        throw new BadRequestException('You are not a player in this match');
      }

      // Se valida contra la ventana absoluta de la pregunta (hora de llegada al
      // servidor), no contra el estado: aunque el job de cierre corra tarde, una
      // respuesta fuera de [startsAt, endsAt + gracia] se rechaza igual.
      const activeQuestion = match.getActiveQuestion();
      if (
        !activeQuestion ||
        activeQuestion.id !== questionId ||
        !match.isAcceptingAnswers(receivedAt)
      ) {
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
      const window = match.getQuestionWindow()!;
      const points = calculatePoints(
        answer.isCorrect,
        match.getResponseTimeMs(receivedAt),
        window.endsAt - window.startsAt,
      );
      match.recordAnswer(questionId, userId, answer.id, answer.isCorrect, receivedAt, points);
      match.addScore(userId, points);
      await this.store.save(match, lock);

      return {
        isCorrect: answer.isCorrect,
        correctAnswer: correctAnswers,
        playersScores: match.getPlayersWithInfo(),
        points,
        allAnswered: match.haveAllConnectedAnswered(),
        seq: match.getSeq(),
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

  /**
   * Firma la media al momento de enviar la pregunta: el bucket es privado y las
   * URLs vencen, así que las guardadas en el match (o no firmadas) no sirven.
   */
  private async signQuestionDto(question: QuestionDto): Promise<QuestionDto> {
    const [media, options] = await Promise.all([
      this.media.signUrl(question.media),
      Promise.all(
        question.options.map(async (option) => ({
          ...option,
          media: await this.media.signUrl(option.media),
        })),
      ),
    ]);
    return { ...question, media, options };
  }

  private toSnapshot(match: Match, userId: string): GameStateSnapshot {
    const question = match.getActiveQuestion();
    const window = question ? match.getQuestionWindow() : null;

    return {
      roomId: match.getRoomId(),
      level: match.getDifficulty(),
      modeMatch: match.getMode(),
      status: match.getStatus(),
      players: match.getPlayersWithInfo(),
      questionNumber: match.getcurrentQuestionIndex(),
      totalQuestions: match.getQuestions().length,
      question: question ? this.toQuestionDto(question) : null,
      startsAt: window?.startsAt ?? null,
      endsAt: window?.endsAt ?? null,
      answeredOptionId: question
        ? (match.getAnswerOf(question.id, userId)?.optionId ?? null)
        : null,
      nextQuestionAt: match.getNextQuestionAt(),
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
