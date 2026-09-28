import { Column, Entity, JoinColumn, ManyToOne, Unique } from 'typeorm';
import { IsInt, IsNotEmpty, IsOptional, IsString, IsUUID } from 'class-validator';
import { CoreEntity } from './model.core';
import { Story } from './story.entity';
import { User } from './user.entity';

/** Corrección de la IA (ver language-review.types). */
export interface StoryCorrectionRecord {
  original: string;
  suggestion: string;
  type: 'grammar' | 'spelling' | 'vocabulary' | 'punctuation';
  explanation: string;
}

export interface StoryPanelScoreRecord {
  accuracy: number;
  firstTryBonus: number;
  selfCorrectionBonus: number;
  timeoutPenalty: boolean;
  total: number;
}

export interface StorySpeechMarkRecord {
  time: number;
  start: number;
  end: number;
  value: string;
}

/** Viñeta confirmada de una historieta terminada. */
@Entity()
@Unique(['storyId', 'order'])
export class StoryPanel extends CoreEntity {
  @ManyToOne(() => Story, (story) => story.panels, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'story_id' })
  story!: Story;

  @IsUUID()
  @Column({ name: 'story_id', type: 'uuid' })
  storyId!: string;

  @IsInt()
  @Column({ type: 'int' })
  order!: number;

  @ManyToOne(() => User, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'author_id' })
  author?: User;

  @IsOptional()
  @IsUUID()
  @Column({ name: 'author_id', type: 'uuid', nullable: true })
  authorId!: string | null;

  /** Nombre del autor cuando jugó (se ve aunque después cambie o se borre). */
  @IsString()
  @Column()
  authorName!: string;

  /** Último texto del jugador; vacío si el turno venció sin borradores. */
  @IsString()
  @Column({ type: 'text' })
  originalText!: string;

  /** Texto corregido: el que se narra. */
  @IsString()
  @IsNotEmpty()
  @Column({ type: 'text' })
  finalText!: string;

  @IsString()
  @Column({ type: 'text' })
  scene!: string;

  @Column({ type: 'jsonb', default: () => "'[]'" })
  characterIds!: string[];

  @Column({ type: 'jsonb', default: () => "'[]'" })
  corrections!: StoryCorrectionRecord[];

  @Column({ type: 'jsonb' })
  score!: StoryPanelScoreRecord;

  /** userId → emoji. */
  @Column({ type: 'jsonb', default: () => "'{}'" })
  reactions!: Record<string, string>;

  /** none | ready | failed (nunca pending: se guarda con la media terminada). */
  @IsString()
  @Column({ default: 'none' })
  mediaStatus!: string;

  /** Keys de S3 (bucket privado): las URLs se firman al servir. */
  @Column({ type: 'varchar', nullable: true })
  audioKey!: string | null;

  @Column({ type: 'varchar', nullable: true })
  imageKey!: string | null;

  @Column({ type: 'jsonb', nullable: true })
  speechMarks!: StorySpeechMarkRecord[] | null;
}
