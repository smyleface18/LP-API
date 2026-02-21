import { Injectable } from '@nestjs/common';
import { QuestionService } from '../question/question.service';

@Injectable()
export class GameService {
  constructor(private readonly questionService: QuestionService) {}

  async getQuestions() {
    return await this.questionService.getRandomQuestions();
  }
}
