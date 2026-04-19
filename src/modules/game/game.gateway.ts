import {
  WebSocketGateway,
  SubscribeMessage,
  MessageBody,
  WebSocketServer,
  OnGatewayDisconnect,
  OnGatewayConnection,
  ConnectedSocket,
} from '@nestjs/websockets';
import { BadRequestException } from '@nestjs/common';
import { Server } from 'socket.io';
import { User } from 'src/db/entities';
import { Repository } from 'typeorm';
import { InjectRepository } from '@nestjs/typeorm';
import { MatchService } from './match/match.service';
import { ApiResponse } from 'src/common/src/api/api.type';
import { ConnectionGameSocket, CreateGameDto, JoinGameDto } from './types';
import { MatchStatus, QuestionDto } from './match/domain/match.interface';
import { OnEvent } from '@nestjs/event-emitter';
import { WsAuthService } from 'src/common/src/ws-auth/ws-auth.service';
import { GameService } from './game.service';

@WebSocketGateway({
  namespace: '/game',
  cors: {
    origin: '*',
    credentials: true,
    methods: ['GET', 'POST'],
  },
  transports: ['websocket', 'polling'],
})
export class GameGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer() server!: Server;

  constructor(
    private readonly matchService: MatchService,
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    private readonly wsAuthService: WsAuthService,
    private readonly gameService: GameService,
  ) {}

  async handleConnection(
    @ConnectedSocket() client: ConnectionGameSocket,
  ): Promise<ApiResponse<null>> {
    const token = client.handshake.auth?.token as string;
    console.log('Token recibido en conexión:', token);
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

      console.log(
        '[GameGateway] user connected - userId:',
        client.data.userId,
        '- username:',
        payload.username,
      );
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error('Auth error:', errorMessage);

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

    console.log(`user desconeted : ${userId}`);
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
    });

    if (!user) {
      throw new BadRequestException('user not found');
    }

    const match = await this.matchService.createMatch(
      createGameDto.level,
      createGameDto.modeMatch,
      user,
    );
    match.addPlayer(user.id, user.username, user.level, user.avatar?.url);

    console.log('roomId del match:', match.getRoomId());
    console.log('rooms antes del join:', [...client.rooms]);

    await client.join(match.getRoomId());

    console.log('rooms después del join:', [...client.rooms]);
    client.data.roomId = match.getRoomId();

    this.server.to(match.getRoomId()).emit('playersUpdated', {
      players: match.getPlayersWithInfo(),
    });

    console.log(`Usuario ${user.id} se ha unido al juego`);
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
    });

    if (!user) {
      throw new BadRequestException('user not found');
    }

    const match = await this.matchService.getMatch(joinGameDto.roomId);

    if (match.getStatus() == MatchStatus.STARTING || match.getStatus() == MatchStatus.PREPARING) {
      throw new BadRequestException('The game has already started.');
    }

    // joinMatch returns the updated match with the new player added
    const updatedMatch = await this.matchService.joinMatch(
      joinGameDto.roomId,
      user.id,
      user.username,
      user.level,
      user.avatar?.url,
    );

    await client.join(joinGameDto.roomId);
    client.data.roomId = joinGameDto.roomId;

    // Emit with the UPDATED match that includes the new player
    this.server.to(joinGameDto.roomId).emit('playersUpdated', {
      players: updatedMatch.getPlayersWithInfo(),
    });

    console.log(`Usuario ${user.id} se ha unido al juego`);

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

    const match = await this.matchService.getMatch(roomId);

    const answer = match
      .getQuestionById(data.questionId)
      .options.find((op) => op.id == data.answerId);

    client.emit('answerResult', {
      correct: answer?.isCorrect,
      correctAnswer: match.getQuestionById(data.questionId).options.filter((op) => op.isCorrect),
    });

    await this.matchService.addScore(roomId, userId, answer?.isCorrect ? 100 : 0);

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

    console.log(`Usuario ${userId} ha abandonado la sala ${roomId}`);
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
    console.log(`📋 [GameGateway] Sending question ${payload.questionNumber}/${payload.totalQuestions} to room ${payload.roomId}`);

    this.server.to(payload.roomId).emit('newQuestion', {
      question: payload.question,
      questionNumber: payload.questionNumber,
      totalQuestions: payload.totalQuestions,
      timeLimit: payload.timeLimit,
    });
  }

  @OnEvent('game.question-ended')
  handleQuestionEnded(payload: { roomId: string }) {
    console.log(`⏱️ [GameGateway] Question ended for room ${payload.roomId}`);
    this.server.to(payload.roomId).emit('questionEnded');
  }

  @OnEvent('game.finished')
  handleGameFinished(payload: { roomId: string; results: any[] }) {
    console.log(`🏁 [GameGateway] Game finished - room ${payload.roomId}, ${payload.results.length} players`);
    this.server.to(payload.roomId).emit('gameEnded', { results: payload.results });
    this.server.in(payload.roomId).socketsLeave(payload.roomId);
  }
}
