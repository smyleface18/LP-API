import { IsNotEmpty, IsNumber, IsString } from 'class-validator';
import { CoreEntity, S3Object } from './model.core';
import { Column, Entity, JoinColumn, ManyToMany, ManyToOne, OneToMany } from 'typeorm';
import { CategoryQuestion } from './category-question.entity';
import { QuestionOption } from './question-option.entity';
import { Game } from './game.entity';
@Entity()
export class Question extends CoreEntity {
  @IsString()
  @Column()
  questionText: string;

  @ManyToOne(() => CategoryQuestion, (category) => category.questions)
  @JoinColumn({ name: 'category_id' })
  category: CategoryQuestion;

  @OneToMany(() => QuestionOption, (questionOption) => questionOption.question, {
    cascade: true,
  })
  options: QuestionOption[];

  @IsNotEmpty()
  @Column({ name: 'category_id' })
  categoryId: string;

  @IsNumber()
  @Column({
    type: 'int',
    default: 5000,
  })
  timeLimit: number; // debe ser en milisegundo

  @Column({ type: 'json', nullable: true })
  media?: S3Object;

  @ManyToMany(() => Game, (game) => game.questions)
  games: Game[];
}
