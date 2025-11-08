import { PartialType } from '@nestjs/mapped-types';
import { CreateCategoryQuestionDto } from './create-category-question.dto';

export class UpdateCategoryQuestionDto extends PartialType(CreateCategoryQuestionDto) {}
