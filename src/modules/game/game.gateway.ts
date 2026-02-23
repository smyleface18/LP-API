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
import { BadRequestException, OnModuleDestroy } from '@nestjs/common';
import { Server, Socket } from 'socket.io';
import { Game, User, UserGame } from 'src/db/entities';
import { Repository } from 'typeorm';
import { InjectRepository } from '@nestjs/typeorm';
import { Match } from './match/domain/match.entity';
import { MatchService } from './match/match.service';
import { ConnectionGameSocket } from './dto/connection-game.dto';
import { GatewayResponse } from './dto/response-gatewey.dto';
import { Level } from 'src/db/enum/question.enum';
import { ModeMatch } from './match/domain/match.interface';

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

  private matchs: Match[];

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

  handleConnection(@ConnectedSocket() client: ConnectionGameSocket): GatewayResponse {
    const userId = client.data.userId;

    console.log(`user connected: ${userId}`);

    return {
      ok: true,
    };
  }

  async handleDisconnect(
    @ConnectedSocket() client: ConnectionGameSocket,
  ): Promise<GatewayResponse> {
    const userId = client.data.userId;
    const roomId = client.data.roomId;
    await this.matchService.disconnectUser(userId, roomId);

    console.log(`usuario desconectado: ${userId}`);
    return {
      ok: true,
    };
  }

  @SubscribeMessage('joinGame')
  async handleJoinGame(
    @MessageBody() data: { userId: string; roomId: string },
    @ConnectedSocket() client: Socket,
  ) {
    const user = await this.userRepository.findOne({
      where: {
        id: data.userId,
      },
    });

    if (!user) {
      throw new BadRequestException('user not found');
    }

    const match = await this.matchService.createMatch(Level.A1, ModeMatch.SINGLEPLAYER); // todo: implentar la manera de definir el level de la partida

    await client.join(match.getRoomId());
    console.log(`Usuario ${user.id} se ha unido al juego`);

    return { ok: true };
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
      correctAnswer: match.getQuestionById(data.questionId).options.find((op) => op.isCorrect),
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
