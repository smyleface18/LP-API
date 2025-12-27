import { PartialType } from '@nestjs/mapped-types';
import { CreateQuestionOptionDto } from './create-question-option.dto';

export class UpdateQuestionOptionDto extends PartialType(CreateQuestionOptionDto) {}
