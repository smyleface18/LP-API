import { OmitType } from '@nestjs/mapped-types';
import { QuestionOption } from '@/db/entities/question-option.entity';

export class CreateQuestionOptionDto extends OmitType(QuestionOption, [
  'id',
  'createdAt',
  'updatedAt',
  'active',
  'question',
] as const) {}
