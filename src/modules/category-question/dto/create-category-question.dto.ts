import { OmitType } from '@nestjs/mapped-types';
import { CategoryQuestion } from '@/db/entities';

export class CreateCategoryQuestionDto extends OmitType(CategoryQuestion, [
  'id',
  'active',
  'createdAt',
  'updatedAt',
  'questions',
] as const) {}
