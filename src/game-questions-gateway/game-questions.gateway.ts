import { Socket } from 'socket.io';
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  OnGatewayInit,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Server } from 'http';
import { GameQuestionsGatewayService } from './game-questions-gateway.service';

@WebSocketGateway({
  cors: {
    origin: '*',
  },
})
export class GameQuestionsGateway
  implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect
{
  @WebSocketServer()
  server: Server;

  constructor(private readonly questionsService: GameQuestionsGatewayService) {}

  afterInit() {
    console.log('✅ WebSocket Gateway Inicializado');

    setInterval(() => {
      const question = this.questionsService.getRandomQuestion();
      console.log('⏱️ Enviando pregunta automática:', question.text);

      this.server.emit('question', question); // 🔥 Emite a TODOS los clientes
    }, 20000); // 20 segundos
  }

  handleConnection(client: Socket) {
    console.log('✅ Cliente conectado:', client.id);
  }

  handleDisconnect(client: Socket) {
    console.log('❌ Cliente desconectado:', client.id);
  }

  @SubscribeMessage('getQuestion')
  handleGetQuestion(@ConnectedSocket() client: Socket, @MessageBody() payload: any) {
    console.log('📩 Cliente pide pregunta:', payload);
    const question = this.questionsService.getRandomQuestion();
    client.emit('question', question);
  }
}

interface Question {
  text: string;
  options: string[];
  correctAnswer: number;
}
