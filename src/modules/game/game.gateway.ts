import {
  WebSocketGateway,
  SubscribeMessage,
  MessageBody,
  WebSocketServer,
  OnGatewayDisconnect,
  OnGatewayConnection,
  ConnectedSocket,
} from '@nestjs/websockets';
import { BadRequestException, Logger } from '@nestjs/common';
import { Server } from 'socket.io';
import { User } from '@/db/entities';
import { Repository } from 'typeorm';
import { InjectRepository } from '@nestjs/typeorm';
import { MatchService } from './match/match.service';
import { ApiResponse } from '@/common/src/api/api.type';
import { ConnectionGameSocket, CreateGameDto, JoinGameDto } from './types';
import { MatchStatus, QuestionDto } from './match/domain/match.interface';
import { OnEvent } from '@nestjs/event-emitter';
import { WsAuthService } from '@/common/src/ws-auth/ws-auth.service';
import { GameService } from './game.service';
import { MediaService } from '../media/media.service';

@WebSocketGateway({
  namespace: '/game',
  cors: {
    origin: true,
    credentials: true,
    methods: ['GET', 'POST'],
  },
  transports: ['websocket', 'polling'],
})
export class GameGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer() server!: Server;
  private readonly logger = new Logger(GameGateway.name);
  private readonly rematchRequests = new Map<string, Set<string>>();

  constructor(
    private readonly matchService: MatchService,
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    private readonly wsAuthService: WsAuthService,
    private readonly gameService: GameService,
    private readonly mediaService: MediaService,
  ) {}

  async handleConnection(
    @ConnectedSocket() client: ConnectionGameSocket,
  ): Promise<ApiResponse<null>> {
    const token = client.handshake.auth?.token as string;
    if (!token) {
      client.emit('error', { message: 'Token missing' });
      client.disconnect();
      return {
        ok: true,
        data: null,
        message: 'user disconnect of game',
      };
    }

    try {
      const payload = await this.wsAuthService.verifyToken(token);

      client.data.userId = payload.username;
      client.data.role = payload['cognito:groups'] || [];

      this.logger.debug(`user connected: ${client.data.userId}`);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.logger.warn(`socket auth failed: ${errorMessage}`);

      client.emit('error', { message: 'Unauthorized' });
      client.disconnect();
    }

    return {
      ok: true,
      data: null,
      message: 'user conected of game',
    };
  }

  handleDisconnect(@ConnectedSocket() client: ConnectionGameSocket): ApiResponse<null> {
    const userId = client.data.userId;
    const roomId = client.data.roomId;

    if (!userId || !roomId) {
      return {
        ok: true,
        data: null,
        message: 'user desconeted of game',
      };
    }

    this.logger.debug(`user disconnected: ${userId}`);
    return {
      ok: true,
      data: null,
      message: 'user desconeted of game',
    };
  }

  @SubscribeMessage('createGame')
  async handleCreateGame(
    @MessageBody() createGameDto: CreateGameDto,
    @ConnectedSocket() client: ConnectionGameSocket,
  ): Promise<ApiResponse<any>> {
    const user = await this.userRepository.findOne({
      where: {
        id: client.data.userId,
      },
      relations: ['avatar'],
    });

    if (!user) {
      throw new BadRequestException('user not found');
    }

    // Match toma el avatar de `owner.avatar?.url` en su constructor, así que
    // hay que firmarlo ANTES de crear el match (no sirve firmarlo después:
    // el owner ya quedaría agregado con la URL sin firmar).
    const signedAvatar = await this.mediaService.signUrl(user.avatar);

    const match = await this.matchService.createMatch(
      createGameDto.level,
      createGameDto.modeMatch,
      {
        ...user,
        avatar: signedAvatar,
      },
    );

    await client.join(match.getRoomId());

    client.data.roomId = match.getRoomId();

    this.server.to(match.getRoomId()).emit('playersUpdated', {
      players: match.getPlayersWithInfo(),
    });

    this.logger.debug(`user ${user.id} created room ${match.getRoomId()}`);
    return {
      ok: true,
      data: {
        roomId: match.getRoomId(),
        level: match.getDifficulty(),
        modeMatch: match.getMode(),
      },
      message: 'match created',
    };
  }

  @SubscribeMessage('joinGame')
  async handleJoinGame(
    @MessageBody() joinGameDto: JoinGameDto,
    @ConnectedSocket() client: ConnectionGameSocket,
  ): Promise<ApiResponse<any>> {
    const user = await this.userRepository.findOne({
      where: {
        id: client.data.userId,
      },
      relations: ['avatar'],
    });

    if (!user) {
      throw new BadRequestException('user not found');
    }

    const match = await this.matchService.getMatch(joinGameDto.roomId);

    if (match.getStatus() == MatchStatus.STARTING || match.getStatus() == MatchStatus.PREPARING) {
      throw new BadRequestException('The game has already started.');
    }

    const avatar = await this.mediaService.signUrl(user.avatar);

    // joinMatch returns the updated match with the new player added
    const updatedMatch = await this.matchService.joinMatch(
      joinGameDto.roomId,
      user.id,
      user.username,
      user.level,
      user.score,
      avatar?.url,
    );

    await client.join(joinGameDto.roomId);
    client.data.roomId = joinGameDto.roomId;

    // Emit with the UPDATED match that includes the new player
    this.server.to(joinGameDto.roomId).emit('playersUpdated', {
      players: updatedMatch.getPlayersWithInfo(),
    });

    this.logger.debug(`user ${user.id} joined room ${joinGameDto.roomId}`);

    return {
      ok: true,
      data: {
        roomId: updatedMatch.getRoomId(),
        level: updatedMatch.getDifficulty(),
        modeMatch: updatedMatch.getMode(),
      },
      message: 'match join',
    };
  }

  @SubscribeMessage('answer')
  async handleAnswer(
    @MessageBody() data: { questionId: string; answerId: string },
    @ConnectedSocket() client: ConnectionGameSocket,
  ) {
    if (!data.questionId || !data.answerId) {
      throw new BadRequestException('missing questionId or anwerId');
    }
    const userId = client.data.userId;
    const roomId = client.data.roomId;

    if (!userId || !roomId) {
      throw new BadRequestException('missing userId or roomId');
    }

    const result = await this.matchService.processAnswer(
      roomId,
      data.questionId,
      data.answerId,
      userId,
    );

    client.emit('answerResult', {
      correct: result.isCorrect,
      correctAnswer: result.correctAnswer,
    });

    this.server.to(roomId).emit('playersUpdated', {
      players: result.playersScores,
    });

    return { received: true };
  }

  @SubscribeMessage('startGame')
  async handleStartGame(@ConnectedSocket() client: ConnectionGameSocket) {
    const user = await this.userRepository.findOne({
      where: {
        id: client.data.userId,
      },
    });

    if (!user) {
      throw new BadRequestException('user not found');
    }

    if (!client.data.roomId) {
      throw new BadRequestException('missing roomId');
    }

    await this.gameService.start(client.data.roomId, user.id);
    this.server.to(client.data.roomId).emit('gameStarted');

    return { success: true };
  }

  @SubscribeMessage('requestRematch')
  async handleRequestRematch(@ConnectedSocket() client: ConnectionGameSocket) {
    const roomId = client.data.roomId;
    const userId = client.data.userId;
    if (!roomId || !userId) throw new BadRequestException('missing userId or roomId');

    const match = await this.matchService.getMatch(roomId);
    if (match.getStatus() !== MatchStatus.FINISHED) {
      throw new BadRequestException('The game is not finished yet.');
    }

    await client.join(roomId);
    const requests = this.rematchRequests.get(roomId) ?? new Set<string>();
    requests.add(userId);
    this.rematchRequests.set(roomId, requests);

    const players = match.getPlayersWithInfo();
    this.server.to(roomId).emit('rematchStatus', {
      accepted: requests.size,
      total: players.length,
    });

    if (requests.size === players.length) {
      const rematch = await this.matchService.resetForRematch(roomId);
      this.rematchRequests.delete(roomId);
      this.server.to(roomId).emit('rematchReady', {
        roomId: rematch.getRoomId(),
        level: rematch.getDifficulty(),
        modeMatch: rematch.getMode(),
        players: rematch.getPlayersWithInfo(),
      });
    }

    return { success: true };
  }

  @SubscribeMessage('leaveRoom')
  async handleLeaveRoom(@ConnectedSocket() client: ConnectionGameSocket) {
    const userId = client.data.userId;
    const roomId = client.data.roomId;

    if (!userId || !roomId) {
      throw new BadRequestException('missing userId or roomId');
    }

    await this.matchService.disconnectUser(userId, roomId);

    await client.leave(roomId);

    const match = await this.matchService.getMatch(roomId);
    this.server.to(roomId).emit('playersUpdated', {
      players: match.getPlayersWithInfo(),
    });

    this.logger.debug(`user ${userId} left room ${roomId}`);
    client.data.roomId = undefined;

    return { success: true };
  }

  @OnEvent('game.next-question')
  handleNextQuestion(payload: {
    roomId: string;
    question: QuestionDto;
    questionNumber: number;
    totalQuestions: number;
    timeLimit: number;
  }) {
    this.server.to(payload.roomId).emit('newQuestion', {
      question: payload.question,
      questionNumber: payload.questionNumber,
      totalQuestions: payload.totalQuestions,
      timeLimit: payload.timeLimit,
    });
  }

  @OnEvent('game.question-ended')
  handleQuestionEnded(payload: { roomId: string }) {
    this.server.to(payload.roomId).emit('questionEnded');
  }

  @OnEvent('game.finished')
  handleGameFinished(payload: { roomId: string; results: any[] }) {
    this.server.to(payload.roomId).emit('gameEnded', { results: payload.results });
    this.server.in(payload.roomId).socketsLeave(payload.roomId);
  }
}
