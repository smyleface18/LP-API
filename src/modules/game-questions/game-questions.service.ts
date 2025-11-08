import { Injectable } from '@nestjs/common';
import { QuestionService } from '../question/question.service';

@Injectable()
export class GameQuestionsService {
  constructor(private readonly questionService: QuestionService) {}

  async getQuestion() {
    return await this.questionService.getRandomQuestions();
  }
}
