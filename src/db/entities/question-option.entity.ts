import { Column, Entity, JoinColumn, ManyToOne } from 'typeorm';
import { CoreEntity, S3Object } from './model.core';
import { Question } from './question.entity';

@Entity()
export class QuestionOption extends CoreEntity {
  @Column({ nullable: true })
  text?: string;

  @Column({ type: 'json', nullable: true })
  media?: S3Object;

  @Column({ default: false })
  isCorrect: boolean;

  @ManyToOne(() => Question, (q) => q.options, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'question_id' })
  question: Question;

  @Column({ name: 'question_id' })
  questionId: string;
}
