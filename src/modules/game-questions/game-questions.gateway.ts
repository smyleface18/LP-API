import {
  WebSocketGateway,
  SubscribeMessage,
  MessageBody,
  WebSocketServer,
  OnGatewayInit,
  OnGatewayDisconnect,
  OnGatewayConnection,
  ConnectedSocket,
} from '@nestjs/websockets';
import { GameQuestionsService } from './game-questions.service';
import { OnModuleDestroy } from '@nestjs/common';
import { Server, Socket } from 'socket.io';
import { Question } from 'src/db/entities';

@WebSocketGateway({
  namespace: '/game',
  // ⬇️ AGREGAR ESTO
  cors: {
    origin: '*', // Permite todas las conexiones (desarrollo)
    credentials: true,
    methods: ['GET', 'POST'],
  },
  // Opcional pero recomendado
  transports: ['websocket', 'polling'],
})
export class GameQuestionsGateway
  implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect, OnModuleDestroy
{
  @WebSocketServer() server: Server;

  private questions: Question[] = [];
  private timeouts: NodeJS.Timeout[] = [];
  private connectedUsers = new Map<string, string>(); // socketId -> userId

  constructor(private readonly gameQuestionsService: GameQuestionsService) {}

  async afterInit() {
    console.log('WebSocket Gateway inicializado');
    // Cargar preguntas al iniciar
    this.questions = await this.gameQuestionsService.getQuestion();
  }

  handleConnection(client: Socket) {
    console.log(`Cliente conectado: ${client.id}`);
  }

  handleDisconnect(client: Socket) {
    console.log(`Cliente desconectado: ${client.id}`);
    this.connectedUsers.delete(client.id);
  }

  @SubscribeMessage('joinGame')
  async handleJoinGame(@MessageBody() data: { userId: string }, @ConnectedSocket() client: Socket) {
    this.connectedUsers.set(client.id, data.userId);
    await client.join(data.userId); // Esperar a que se una a la sala
    console.log(`Usuario ${data.userId} unido al juego`);

    return { success: true, message: 'Unido al juego correctamente' };
  }

  // Método para iniciar el juego manualmente
  @SubscribeMessage('startGame')
  async handleStartGame() {
    await this.startGame();
    return { success: true, message: 'Juego iniciado' };
  }

  private async startGame() {
    // Limpiar timeouts anteriores si existen
    this.clearTimeouts();

    // Cargar preguntas frescas
    this.questions = await this.gameQuestionsService.getQuestion();
    console.log(`Iniciando juego con ${this.questions.length} preguntas`);

    // Enviar preguntas
    this.sendQuestions();
  }

  private sendQuestions() {
    this.questions.forEach((question, index) => {
      const timeout = setTimeout(() => {
        this.server.emit('newQuestion', {
          question,
          questionNumber: index + 1,
          totalQuestions: this.questions.length,
          timeLimit: 5000, // 5 segundos para responder
        });
        console.log(`Pregunta ${index + 1} de ${this.questions.length} enviada`);

        // Emitir fin de juego después de la última pregunta
        if (index === this.questions.length - 1) {
          setTimeout(() => {
            this.server.emit('gameEnded', {
              totalQuestions: this.questions.length,
            });
            console.log('Juego finalizado');
          }, 5000); // Esperar 5 segundos después de la última pregunta
        }
      }, index * 5000); // 5 segundos entre preguntas (30 para responder + 5 de pausa)

      this.timeouts.push(timeout);
    });
  }

  @SubscribeMessage('answer')
  handleAnswer(
    @MessageBody() data: { questionId: string; userId: string; answer: string },
    @ConnectedSocket() client: Socket,
  ) {
    console.log(`Respuesta recibida de usuario ${data.userId}`);

    // Buscar la pregunta en el array cargado
    const question: Question | undefined = this.questions.find((q) => q.id === data.questionId);

    if (!question) {
      client.emit('answerResult', {
        error: 'Pregunta no encontrada',
        correct: false,
      });
      return;
    }

    const correct = question.correctAnswer === data.answer;

    // Emitir resultado solo al usuario que respondió
    // Usar el socketId del cliente que envió la respuesta
    client.emit('answerResult', {
      correct,
      correctAnswer: question.correctAnswer,
      questionId: data.questionId,
    });

    console.log(
      `Usuario ${data.userId} respondió ${correct ? 'correctamente' : 'incorrectamente'}`,
    );

    return { received: true };
  }

  // Método para detener el juego
  @SubscribeMessage('stopGame')
  handleStopGame() {
    this.clearTimeouts();
    this.server.emit('gameStopped');
    console.log('Juego detenido manualmente');

    return { success: true, message: 'Juego detenido' };
  }

  private clearTimeouts() {
    this.timeouts.forEach((timeout) => clearTimeout(timeout));
    this.timeouts = [];
  }

  onModuleDestroy() {
    console.log('Destruyendo módulo GameQuestionsGateway');
    this.clearTimeouts();
  }
}
