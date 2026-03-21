import {
  WebSocketGateway,
  SubscribeMessage,
  MessageBody,
  WebSocketServer,
  OnGatewayDisconnect,
  OnGatewayConnection,
  ConnectedSocket,
} from '@nestjs/websockets';
import { GameService } from './game.service';
import { BadRequestException } from '@nestjs/common';
import { Server } from 'socket.io';
import { Game, User, UserGame } from 'src/db/entities';
import { Repository } from 'typeorm';
import { InjectRepository } from '@nestjs/typeorm';
import { MatchService } from './match/match.service';
import { ApiResponse } from 'src/common/src/api/api.type';
import { ConnectionGameSocket, CreateGameDto } from './types';
import { Match } from './match/domain/match.entity';

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
  @WebSocketServer() server: Server;

  constructor(
    private readonly gameService: GameService,
    private readonly matchService: MatchService,
    @InjectRepository(Game)
    private readonly gameRepository: Repository<Game>,
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    @InjectRepository(UserGame)
    private readonly userGameRepository: Repository<UserGame>,
  ) {}

  handleConnection(@ConnectedSocket() client: ConnectionGameSocket): ApiResponse<null> {
    const userId = client.data.userId;

    console.log(`user connected: ${userId}`);

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
    await this.matchService.disconnectUser(userId, roomId);

    console.log(`usuario desconectado: ${userId}`);
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

    const match = await this.matchService.createMatch(createGameDto.level, createGameDto.modeMatch); // todo: implentar la manera de definir el level de la partida
    match.addPlayer(user.id);

    await client.join(match.getRoomId());
    console.log(`Usuario ${user.id} se ha unido al juego`);

    return {
      ok: true,
      data: match,
      message: 'match created',
    };
  }

  @SubscribeMessage('joinGame')
  async handleJoinGame(
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

    const match = await this.matchService.joinMatch(client.data.roomId, user.id);

    await client.join(client.data.roomId);
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
}
