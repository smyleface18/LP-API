import { IsEnum, IsNotEmpty, IsNumber, IsOptional, IsString, IsUUID } from 'class-validator';
import { CoreEntity } from './model.core';
import { Check, Column, Entity, JoinColumn, ManyToMany, ManyToOne, OneToMany } from 'typeorm';
import { CategoryQuestion } from './category-question.entity';
import { QuestionOption } from './question-option.entity';
import { Game } from './game.entity';
import { MediaAsset } from './media-asset.entity';
import { ContentType } from '../enum/question.enum';
@Entity()
@Check(
  `("contentType" = 'TEXT' AND "media_id" IS NULL) OR ("contentType" != 'TEXT' AND "media_id" IS NOT NULL)`,
)
export class Question extends CoreEntity {
  @IsEnum(ContentType)
  @Column({
    type: 'enum',
    enum: ContentType,
  })
  contentType!: ContentType;

  // El enunciado de la pregunta en sí (ej. "¿Cómo se dice 'beber' en inglés?" o,
  // si contentType es AUDIO/IMAGE/VIDEO, "¿Qué palabra es la que dicen en el audio?").
  // Siempre es obligatorio, sea cual sea el contentType — el media es el contenido
  // acompañante, no reemplaza el enunciado.
  @IsNotEmpty()
  @IsString()
  @Column({ type: 'text' })
  text!: string;

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
    default: 5,
  })
  timeLimit!: number; // debe ser en segundos

  @ManyToMany(() => Game, (game) => game.questions)
  games!: Game[];

  @ManyToOne(() => MediaAsset, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'media_id' })
  media?: MediaAsset;

  @IsOptional()
  @IsUUID()
  @Column({ name: 'media_id', type: 'uuid', nullable: true })
  mediaId?: string;
}
