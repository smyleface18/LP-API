import { Column, Entity, JoinColumn, ManyToOne } from 'typeorm';
import { CoreEntity, S3Object } from './model.core';
import { Question } from './question.entity';
import { IsBoolean, IsOptional, IsString, IsUUID, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

@Entity()
export class QuestionOption extends CoreEntity {
  @IsOptional()
  @IsString()
  @Column({ nullable: true })
  text?: string;

  @ValidateNested()
  @Type(() => S3Object)
  @IsOptional()
  @Column({ type: 'json', nullable: true })
  media?: S3Object;

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
