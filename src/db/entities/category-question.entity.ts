import { IsEnum, IsNotEmpty, IsString } from 'class-validator';
import { CoreEntity } from './model.core';
import { Column, Entity, OneToMany } from 'typeorm';
import { Question } from './question.entity';
import { LevelCategoryQuestion, TypeQuestionCategory } from '../enum/question.enum';

@Entity()
export class CategoryQuestion extends CoreEntity {
  @IsEnum(LevelCategoryQuestion)
  @Column({
    type: 'enum',
    enum: LevelCategoryQuestion,
  })
  level: LevelCategoryQuestion;

  @IsString()
  @IsNotEmpty()
  @Column()
  descriptionCategory: string;

  @OneToMany(() => Question, (question) => question.category)
  questions: Question[];

  @IsEnum(TypeQuestionCategory)
  @Column({
    type: 'enum',
    enum: TypeQuestionCategory,
  })
  type: TypeQuestionCategory;
}
