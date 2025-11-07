import { PartialType } from '@nestjs/mapped-types';
import { CreateGameQuestionDto } from './create-game-question.dto';

export class UpdateGameQuestionDto extends PartialType(CreateGameQuestionDto) {
  id: number;
}
