import { Injectable } from '@nestjs/common';
import { CreateGameQuestionsGatewayDto } from './dto/create-game-questions-gateway.dto';
import { UpdateGameQuestionsGatewayDto } from './dto/update-game-questions-gateway.dto';

interface Question {
  text: string;
  options: string[];
  correctAnswer: number;
}

@Injectable()
export class GameQuestionsGatewayService {
  create(createGameQuestionsGatewayDto: CreateGameQuestionsGatewayDto) {
    return 'This action adds a new gameQuestionsGateway';
  }

  findAll() {
    return `This action returns all gameQuestionsGateway`;
  }

  findOne(id: number) {
    return `This action returns a #${id} gameQuestionsGateway`;
  }

  update(id: number, updateGameQuestionsGatewayDto: UpdateGameQuestionsGatewayDto) {
    return `This action updates a #${id} gameQuestionsGateway`;
  }

  remove(id: number) {
    return `This action removes a #${id} gameQuestionsGateway`;
  }

  getRandomQuestion(): Question {
    const randomIndex = Math.floor(Math.random() * this.questions.length);
    console.log('Pregunta seleccionada:', randomIndex);
    return { ...this.questions[randomIndex] };
  }

  questions: Question[] = [
    {
      text: '¿Cuál es la capital de Francia?',
      options: ['Madrid', 'París', 'Roma', 'Londres'],
      correctAnswer: 1,
    },
    {
      text: '¿Qué lenguaje se ejecuta en el navegador?',
      options: ['Java', 'C#', 'JavaScript', 'PHP'],
      correctAnswer: 2,
    },
  ];
}
