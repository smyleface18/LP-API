import { IsNotEmpty, IsNumber, IsOptional, IsUUID } from 'class-validator';
import { ContentObject, CoreEntity } from './model.core';
import { Column, Entity, JoinColumn, ManyToMany, ManyToOne, OneToMany } from 'typeorm';
import { CategoryQuestion } from './category-question.entity';
import { QuestionOption } from './question-option.entity';
import { Game } from './game.entity';
@Entity()
export class Question extends CoreEntity {
  @Column({ type: 'json' })
  content!: ContentObject;

  @IsOptional()
  @Column({ type: 'text', nullable: true })
  moreInfo?: string;

  @ManyToOne(() => CategoryQuestion, (category) => category.questions)
  @JoinColumn({ name: 'category_id' })
  category!: CategoryQuestion;

  @OneToMany(() => QuestionOption, (questionOption) => questionOption.question, {
    cascade: true,
  })
  options!: QuestionOption[];

  @IsNotEmpty()
  @IsUUID()
  @Column({ name: 'category_id', type: 'uuid' })
  categoryId!: string;

  @IsOptional()
  @IsNumber()
  @Column({
    type: 'int',
    default: 5000,
  })
  timeLimit!: number; // debe ser en milisegundo

  @ManyToMany(() => Game, (game) => game.questions)
  games!: Game[];
}
