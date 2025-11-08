import { PartialType } from '@nestjs/mapped-types';
import { CategoryQuestion } from 'src/db/entities';

export class CreateCategoryQuestionDto extends PartialType(CategoryQuestion) {}
