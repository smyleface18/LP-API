import { PartialType } from '@nestjs/mapped-types';
import { Question } from 'src/db/entities';

export class CreateQuestionDto extends PartialType(Question) {}
