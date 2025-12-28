import { IsEnum, IsNotEmpty, IsString } from 'class-validator';
import { CoreEntity } from './model.core';
import { Column, Entity, OneToMany } from 'typeorm';
import { Question } from './question.entity';
import { Level, TypeQuestionCategory } from '../enum/question.enum';

@Entity()
export class CategoryQuestion extends CoreEntity {
  @IsEnum(Level)
  @Column({
    type: 'enum',
    enum: Level,
  })
  level: Level;

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
