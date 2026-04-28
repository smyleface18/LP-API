import { Column, Entity, JoinColumn, ManyToOne } from 'typeorm';
import { ContentObject, CoreEntity } from './model.core';
import { Question } from './question.entity';
import { IsBoolean, IsUUID } from 'class-validator';

@Entity()
export class QuestionOption extends CoreEntity {
  @Column({ type: 'json' })
  content: ContentObject;

  @IsBoolean()
  @Column({ default: false })
  isCorrect: boolean;

  @ManyToOne(() => Question, (q) => q.options, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'question_id' })
  question: Question;

  @IsUUID()
  @Column({ name: 'question_id', type: 'uuid' })
  questionId: string;
}
