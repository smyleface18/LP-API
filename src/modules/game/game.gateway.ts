import {
  WebSocketGateway,
  SubscribeMessage,
  MessageBody,
  WebSocketServer,
  OnGatewayDisconnect,
  OnGatewayConnection,
  ConnectedSocket,
} from '@nestjs/websockets';
import { BadRequestException, Logger, UseFilters } from '@nestjs/common';
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
import { WsHttpExceptionFilter } from '@/common/src/api/ws-exception.filter';
import { MatchNotFoundError } from './match/domain/exceptions/match-not-found.error';

@UseFilters(WsHttpExceptionFilter)
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
      return {
        ok: false,
        data: null,
        message: 'unauthorized',
      };
    }

    await this.resumeGame(client);

    return {
      ok: true,
      data: null,
      message: 'user conected of game',
    };
  }

  async handleDisconnect(
    @ConnectedSocket() client: ConnectionGameSocket,
  ): Promise<ApiResponse<null>> {
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

    // Se marca desconectado (no "se fue"): al reconectarse vuelve con resumeGame.
    try {
      const outcome = await this.matchService.disconnectUser(userId, roomId);
      this.server.to(roomId).emit('playersUpdated', {
        players: outcome.match.getPlayersWithInfo(),
      });
      // Si los que quedan ya respondieron todos, no hace falta esperar al que se fue.
      if (outcome.allAnswered) {
        await this.gameService.closeQuestionIfAllAnswered(roomId, outcome.seq);
      }
    } catch (error) {
      if (!(error instanceof MatchNotFoundError)) {
        this.logger.warn(`disconnect handling failed: ${(error as Error).message}`);
      }
    }

    return {
      ok: true,
      data: null,
      message: 'user desconeted of game',
    };
  }

  /**
   * Reconexión: si el usuario tenía una partida en curso (en cualquier
   * instancia), vuelve a la sala y recibe el estado completo (`gameState`)
   * para reconstruir la pantalla, incluida la pregunta activa con su ventana.
   */
  private async resumeGame(client: ConnectionGameSocket) {
    try {
      const snapshot = await this.matchService.resume(client.data.userId);
      if (!snapshot) return;

      await client.join(snapshot.roomId);
      client.data.roomId = snapshot.roomId;
      client.emit('gameState', snapshot);
      this.server.to(snapshot.roomId).emit('playersUpdated', { players: snapshot.players });
      this.logger.debug(`user ${client.data.userId} resumed room ${snapshot.roomId}`);
    } catch (error) {
      this.logger.warn(`resume failed for ${client.data.userId}: ${(error as Error).message}`);
    }
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
    // Hora de llegada, antes de cualquier await: es la que se compara con la
    // ventana [startsAt, endsAt + gracia] de la pregunta.
    const receivedAt = Date.now();
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
      receivedAt,
    );

    client.emit('answerResult', {
      correct: result.isCorrect,
      correctAnswer: result.correctAnswer,
      points: result.points,
    });

    this.server.to(roomId).emit('playersUpdated', {
      players: result.playersScores,
    });

    // Después de avisar el resultado, para que llegue antes que questionEnded.
    if (result.allAnswered) {
      await this.gameService.closeQuestionIfAllAnswered(roomId, result.seq);
    }

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

    const { firstQuestionAt } = await this.gameService.start(client.data.roomId, user.id);
    this.server.to(client.data.roomId).emit('gameStarted', { firstQuestionAt });

    return { success: true };
  }

  @SubscribeMessage('requestRematch')
  async handleRequestRematch(@ConnectedSocket() client: ConnectionGameSocket) {
    const roomId = client.data.roomId;
    const userId = client.data.userId;
    if (!roomId || !userId) throw new BadRequestException('missing userId or roomId');

    const { accepted, total, rematch } = await this.matchService.requestRematch(roomId, userId);

    await client.join(roomId);
    this.server.to(roomId).emit('rematchStatus', { accepted, total });

    if (rematch) {
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

    const outcome = await this.matchService.leaveMatch(userId, roomId);

    await client.leave(roomId);

    this.server.to(roomId).emit('playersUpdated', {
      players: outcome.match.getPlayersWithInfo(),
    });

    if (outcome.allAnswered) {
      await this.gameService.closeQuestionIfAllAnswered(roomId, outcome.seq);
    }

    this.logger.debug(`user ${userId} left room ${roomId}`);
    client.data.roomId = undefined;

    return { success: true };
  }

  /**
   * Sincronización de reloj (estilo NTP/Cristian): el cliente manda su hora,
   * recibe la del servidor en el ack y estima su offset con el RTT. Los
   * startsAt/endsAt de las preguntas están en hora del servidor.
   */
  @SubscribeMessage('timeSync')
  handleTimeSync() {
    return { serverTime: Date.now() };
  }

  @OnEvent('game.next-question')
  handleNextQuestion(payload: {
    roomId: string;
    question: QuestionDto;
    questionNumber: number;
    totalQuestions: number;
    timeLimit: number;
    startsAt: number;
    endsAt: number;
  }) {
    this.server.to(payload.roomId).emit('newQuestion', {
      question: payload.question,
      questionNumber: payload.questionNumber,
      totalQuestions: payload.totalQuestions,
      timeLimit: payload.timeLimit,
      startsAt: payload.startsAt,
      endsAt: payload.endsAt,
    });
  }

  @OnEvent('game.question-ended')
  handleQuestionEnded(payload: {
    roomId: string;
    questionId: string;
    nextQuestionAt: number | null;
  }) {
    this.server.to(payload.roomId).emit('questionEnded', {
      questionId: payload.questionId,
      nextQuestionAt: payload.nextQuestionAt,
    });
  }

  @OnEvent('game.finished')
  handleGameFinished(payload: { roomId: string; results: any[] }) {
    this.server.to(payload.roomId).emit('gameEnded', { results: payload.results });
    this.server.in(payload.roomId).socketsLeave(payload.roomId);
  }
}
