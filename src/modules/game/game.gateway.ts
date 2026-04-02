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
import { Match } from './match/domain/match.entity';
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
    console.log('connection socket');
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

      console.log('user connected:', payload.username);
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

    await this.matchService.disconnectUser(userId, roomId);

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
  ): Promise<ApiResponse<Match>> {
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
    match.addPlayer(user.id);

    console.log('roomId del match:', match.getRoomId());
    console.log('rooms antes del join:', [...client.rooms]);

    await client.join(match.getRoomId());

    console.log('rooms después del join:', [...client.rooms]);
    client.data.roomId = match.getRoomId();

    console.log(`Usuario ${user.id} se ha unido al juego`);
    return {
      ok: true,
      data: match,
      message: 'match created',
    };
  }

  @SubscribeMessage('joinGame')
  async handleJoinGame(
    @MessageBody() joinGameDto: JoinGameDto,
    @ConnectedSocket() client: ConnectionGameSocket,
  ): Promise<ApiResponse<Match>> {
    const user = await this.userRepository.findOne({
      where: {
        id: client.data.userId,
      },
    });

    if (!user) {
      throw new BadRequestException('user not found');
    }

    const match = await this.matchService.joinMatch(joinGameDto.roomId, user.id);

    if (match.getStatus() == MatchStatus.STARTING || match.getStatus() == MatchStatus.PREPARING) {
      throw new BadRequestException('The game has already started.');
    }

    await client.join(joinGameDto.roomId);
    client.data.roomId = joinGameDto.roomId;

    console.log(`Usuario ${user.id} se ha unido al juego`);

    return {
      ok: true,
      data: match,
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

    console.log(
      `Usuario ${userId} respondió ${answer?.isCorrect ? 'correctamente' : 'incorrectamente'}`,
    );

    return { received: true };
  }

  @SubscribeMessage('startGame')
  async handleStopGame(@ConnectedSocket() client: ConnectionGameSocket) {
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

  /*
  @SubscribeMessage('stopGame')
  handleStopGame(@ConnectedSocket() client: Socket) {
    const userId = this.connectedUsers.get(client.id);
    if (!userId) return;

    const userGame = this.userGames.get(userId);
    if (userGame?.timeout) clearTimeout(userGame.timeout);

    this.server.to(userId).emit('gameStopped');
    console.log(`Juego detenido manualmente para ${userId}`);

    return { success: true };
  }
*/
  @OnEvent('game.next-question')
  handleNextQuestion(payload: { roomId: string; question: QuestionDto }) {
    console.log('server esta init', this.server);

    console.log('pregunta enviada a:', payload.roomId);

    // Ver todos los rooms activos
    this.server.sockets.adapter.rooms.forEach((sockets, roomId) => {
      console.log(`room "${roomId}":`, [...sockets]);
    });

    // Ver específicamente el room del payload
    const room = this.server.sockets.adapter.rooms.get(payload.roomId);
    console.log('sockets en el room target:', room ? [...room] : 'VACÍO O NO EXISTE');

    this.server.to(payload.roomId).emit('new-question', payload.question);
  }

  /*
  handleNextQuestion(roomId: string, question: QuestionDto) {
    console.log('server esta init', this.server);

    // Ver todos los rooms activos
    this.server.sockets.adapter.rooms.forEach((sockets, roomId) => {
      console.log(`room "${roomId}":`, [...sockets]);
    });

    // Ver específicamente el room del payload
    const room = this.server.sockets.adapter.rooms.get(roomId);
    console.log('sockets en el room target:', room ? [...room] : 'VACÍO O NO EXISTE');

    this.server.to(roomId).emit('new-question', question);
  }
      */
}
