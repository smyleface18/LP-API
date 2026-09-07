import { OmitType } from '@nestjs/mapped-types';
import { Question } from '@/db/entities';

export class CreateQuestionDto extends OmitType(Question, [
  'id',
  'active',
  'createdAt',
  'updatedAt',
  'options',
  'games',
  'category',
] as const) {}
