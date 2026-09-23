import { Check, Column, Entity, JoinColumn, ManyToOne } from 'typeorm';
import { CoreEntity } from './model.core';
import { Question } from './question.entity';
import { MediaAsset } from './media-asset.entity';
import { ContentType } from '../enum/question.enum';
import { IsBoolean, IsEnum, IsOptional, IsString, IsUUID } from 'class-validator';

@Entity()
@Check(
  `("contentType" = 'TEXT' AND "media_id" IS NULL AND "text" IS NOT NULL) OR ("contentType" != 'TEXT' AND "media_id" IS NOT NULL AND "text" IS NULL)`,
)
export class QuestionOption extends CoreEntity {
  @IsEnum(ContentType)
  @Column({
    type: 'enum',
    enum: ContentType,
  })
  contentType!: ContentType;

  @IsOptional()
  @IsString()
  @Column({ type: 'text', nullable: true })
  text?: string;

  @IsBoolean()
  @Column({ default: false })
  isCorrect!: boolean;

  @ManyToOne(() => Question, (q) => q.options, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'question_id' })
  question!: Question;

  @IsUUID()
  @Column({ name: 'question_id', type: 'uuid' })
  questionId!: string;

  @ManyToOne(() => MediaAsset, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'media_id' })
  media?: MediaAsset;

  @IsOptional()
  @IsUUID()
  @Column({ name: 'media_id', type: 'uuid', nullable: true })
  mediaId?: string;
}
