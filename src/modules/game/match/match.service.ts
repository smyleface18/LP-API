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

@Injectable()
export class MatchService {
  constructor(
    private readonly cache: CacheService,
    private readonly questionService: QuestionService,
    private readonly uniqueNames: UniqueNamesAdapter,
    private readonly eventEmitter: EventEmitter2,
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
    const match = await this.getMatch(roomId);

    match.addPlayer(userId, username, level, totalScore, avatar);
    await this.saveMatch(match);

    return match;
  }

  async disconnectUser(userId: string, roomId: string): Promise<Match> {
    const match = await this.getMatch(roomId);
    if (!match) {
      throw new MatchNotFoundError(roomId);
    }

    match.disconnectPlayer(userId);
    await this.saveMatch(match);

    return match;
  }

  async finishMatch(roomId: string) {
    const match = await this.getMatch(roomId);
    if (!match) {
      throw new MatchNotFoundError(roomId);
    }

    const results = match.getResults();

    return results;
  }

  async getMatch(roomId: string): Promise<Match> {
    const match = await this.cache.get<Match>(CacheKeys.match(roomId));
    if (!match) {
      throw new MatchNotFoundError(roomId);
    }

    return Match.fromPersistence(match);
  }

  async nextQuestion(roomId: string): Promise<QuestionDto | null> {
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
    const match = await this.getMatch(roomId);
    if (match.getStatus() !== MatchStatus.FINISHED) {
      throw new BadRequestException('The game is not finished yet.');
    }

    match.resetForRematch();
    await this.saveMatch(match);
    return match;
  }

  async finishCurrentQuestion(roomId: string): Promise<Match> {
    const match = await this.getMatch(roomId);
    match.finishCurrentQuestion();
    await this.saveMatch(match);
    return match;
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
    const match = await this.getMatch(roomId);
    const answer = match.getQuestionById(questionId).options.find((op) => op.id == answerId);
    if (!answer) {
      throw new BadRequestException('Invalid answerId');
    }
    const correctAnswers = match.getQuestionById(questionId).options.filter((op) => op.isCorrect);
    match.addScore(userId, answer.isCorrect ? 100 : 0);
    console.log(`addscore userId: ${userId}, points: ${answer.isCorrect ? 100 : 0}`);
    console.log(match.getPlayersWithInfo());
    await this.saveMatch(match);
    return {
      isCorrect: answer.isCorrect,
      correctAnswer: correctAnswers,
      playersScores: match.getPlayersWithInfo(),
    };
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

  private async saveMatch(match: Match): Promise<void> {
    return await this.cache.set(CacheKeys.match(match.getRoomId()), match.toPersistence(), 900000); // todo: implement definition of ttl by now is 15 minutes
  }

  private toQuestionDto(question: Question): QuestionDto {
    const options: OptionDto[] = question.options.map((option) => {
      return this.toOptionDto(option);
    });

    return {
      id: question.id,
      content: question.content,
      category: question.category,
      categoryId: question.categoryId,
      timeLimit: question.timeLimit,
      options: options,
    };
  }

  private toOptionDto(option: QuestionOption): OptionDto {
    return {
      id: option.id,
      content: option.content,
    };
  }
}
