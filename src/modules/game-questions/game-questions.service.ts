import { Injectable } from '@nestjs/common';
import { CreateGameQuestionDto } from './dto/create-game-question.dto';
import { UpdateGameQuestionDto } from './dto/update-game-question.dto';
import { Question } from 'src/db/entities';
import { DeepPartial } from 'typeorm';

@Injectable()
export class GameQuestionsService {
  create(createGameQuestionDto: CreateGameQuestionDto) {
    return `This action returns all gameQuestions`;
  }

  findAll() {
    return `This action returns all gameQuestions`;
  }

  findOne(id: number) {
    return `This action returns a #${id} gameQuestion`;
  }

  update(id: number, updateGameQuestionDto: UpdateGameQuestionDto) {
    return `This action updates a #${id} gameQuestion`;
  }

  remove(id: number) {
    return `This action removes a #${id} gameQuestion`;
  }

  getRandomQuestion(): DeepPartial<Question> {
    const randomIndex = Math.floor(Math.random() * this.questions.length);
    console.log('Pregunta seleccionada:', randomIndex);
    return { ...this.questions[randomIndex] };
  }

  questions: DeepPartial<Question>[] = [
    {
      question: '¿Cuál es la capital de Francia?',
      options: ['Madrid', 'París', 'Roma', 'Londres'],
      correctAnswer: 'París',
    },
    {
      question: '¿Qué lenguaje se ejecuta en el navegador?',
      options: ['Java', 'C#', 'JavaScript', 'PHP'],
      correctAnswer: 'JavaScript',
    },
  ];
}
