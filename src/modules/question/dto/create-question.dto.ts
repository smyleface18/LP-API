import { PartialType } from '@nestjs/mapped-types';
import { AtLeastOne } from 'src/common/decorators/validators/has-text-or-img.validator';
import { Question } from 'src/db/entities';

@AtLeastOne()
export class CreateQuestionDto extends PartialType(Question) {}
