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
import { Game, QuestionOption, User, UserGame } from 'src/db/entities';
import { Repository } from 'typeorm';
import { InjectRepository } from '@nestjs/typeorm';
import { createClient, RedisClientType } from 'redis';
import { createAdapter } from '@socket.io/redis-adapter';
import { Match, MatchService } from './match.service';

const pubClient: RedisClientType = createClient({ url: 'redis://localhost:6379' });
const subClient: RedisClientType = pubClient.duplicate();

await Promise.all([pubClient.connect(), subClient.connect()]);

@WebSocketGateway({
  namespace: '/game',
  cors: {
    origin: '*',
    credentials: true,
    methods: ['GET', 'POST'],
  },
  transports: ['websocket', 'polling'],
  IoAdapter: createAdapter(pubClient, subClient),
})
export class GameGateway
  implements OnGatewayConnection, OnGatewayDisconnect, OnModuleDestroy
{
  @WebSocketServer() server: Server;

  private connectedUsers = new Map<string, string>(); // socketId -> userId
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

  handleConnection(client: Socket) {
  const userId = client.data.userId;
  this.matchService. (userId);

  console.log(`usuario desconectado: ${userId}`);
  }

  handleDisconnect(@ConnectedSocket() client: Socket) {
  const userId = client.data.userId;
  this.matchService.disconnectUser(userId);

  console.log(`usuario desconectado: ${userId}`);

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

    const questions = await this.gameService.getQuestions();
    const game = this.gameRepository.create({
      difficulty: user.level,
      questions: questions,
    });

    const savedGame = await this.gameRepository.save(game);

    const userGame = this.userGameRepository.create({
      gameId: savedGame.id,
      userId: user.id,
    });

    await this.userGameRepository.save(userGame);

    const match = new Match(savedGame);
    this.matchs.push(match);

    await client.join(`match:${match.getRoomId()}`);
    console.log(`Usuario ${user.id} se ha unido al juego`);
    this.sendNextQuestion(match.getRoomId());

    return { success: true };
  }

  /** Envia la siguiente pregunta o finaliza el juego */
  private sendNextQuestion(roomId: string) {
    const match = this.matchs.find((match) => match.getRoomId() == roomId);
    if (!match) return;

    // Si ya no hay más preguntas -> finalizar
    if (match.currentIndex >= match.) {
      this.server.to(userId).emit('gameEnded', { totalQuestions: userGame.currentIndex });
      console.log(`Juego finalizado para ${userId}`);
      return;
    }

    const question = userGame.questions[userGame.currentIndex];
    console.log(`Enviando pregunta ${userGame.currentIndex + 1} a ${userId}`);

    // Emitir pregunta
    this.server.to(userId).emit('newQuestion', {
      question,
      questionNumber: userGame.currentIndex + 1,
      totalQuestions: userGame.questions.length,
      timeLimit: 5000,
    });
    // Crear timeout para pasar a la siguiente si no responde
    userGame.timeout = setTimeout(() => {
      console.log(`Tiempo agotado para ${userId} en la pregunta ${question.id}`);
      userGame.currentIndex++;
      this.sendNextQuestion(userId);
    }, 5000);
  }

  @SubscribeMessage('answer')
  handleAnswer(
    @MessageBody() data: { questionId: string; userId: string; answer: QuestionOption },
    @ConnectedSocket() client: Socket,
  ) {
    const userGame = this.userGames.get(data.userId);
    if (!userGame) throw new Error('user game not found');

    // Cancelar el timeout actual
    if (userGame.timeout) clearTimeout(userGame.timeout);

    const question = userGame.questions[userGame.currentIndex];
    const correct = data.answer.isCorrect;

    client.emit('answerResult', {
      correct,
      correctAnswer: question.options.filter((op) => op.isCorrect),
      questionId: question.id,
    });

    console.log(
      `Usuario ${data.userId} respondió ${correct ? 'correctamente' : 'incorrectamente'}`,
    );

    // Pasar a la siguiente pregunta
    setTimeout(() => {
      userGame.currentIndex++;
      this.sendNextQuestion(data.userId);
    }, 1000);

    return { received: true };
  }

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

  onModuleDestroy() {
    console.log('Destruyendo módulo GameQuestionsGateway');
    for (const [, game] of this.userGames) {
      if (game.timeout) clearTimeout(game.timeout);
    }
  }
}
