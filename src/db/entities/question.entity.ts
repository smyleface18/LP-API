import { ArrayNotEmpty, IsArray, IsNotEmpty, IsString } from 'class-validator';
import { CoreEntity } from './model.core';
import { Column, Entity, JoinColumn, ManyToOne } from 'typeorm';
import { IsAnswerInOptions } from 'src/common/decorators/validators/is-answer-in-options.validator';
import { CategoryQuestion } from './category-question.entity';

@Entity()
export class Question extends CoreEntity {
  @IsNotEmpty()
  @IsString()
  @Column()
  question: string;

  @IsArray()
  @ArrayNotEmpty()
  @IsString({ each: true })
  @Column('text', { array: true })
  options: string[];

  @IsAnswerInOptions({ message: 'The correct answer must be within options.' })
  @Column()
  correctAnswer: string;

  @ManyToOne(() => CategoryQuestion, (category) => category.questions)
  @JoinColumn({ name: 'category_id' })
  category: CategoryQuestion;

  @IsNotEmpty()
  @Column({ name: 'category_id' })
  categoryId: string;
}
