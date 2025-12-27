import { Column, Entity, JoinColumn, ManyToOne } from 'typeorm';
import { CoreEntity } from './model.core';
import { OptionRenderType } from '../enum/option.enum';
import { Question } from './question.entity';

@Entity()
export class QuestionOption extends CoreEntity {
  @Column({ nullable: true })
  text?: string;

  @Column({
    type: 'enum',
    enum: OptionRenderType,
    default: OptionRenderType.TEXT,
  })
  renderType: OptionRenderType;

  @Column({ nullable: true })
  mediaUrl?: string;

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
