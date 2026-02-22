import { PartialType } from '@nestjs/mapped-types';
import { CreateGameDto } from './create-game-question.dto';

export class UpdateGameDto extends PartialType(CreateGameDto) {
  id: number;
}
