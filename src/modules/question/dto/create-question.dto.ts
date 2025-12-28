import { OmitType } from '@nestjs/mapped-types';
import { Question } from 'src/db/entities';

export class CreateQuestionDto extends OmitType(Question, [
  'id',
  'active',
  'createdAt',
  'updatedAt',
  'games',
  'category',
] as const) {}
