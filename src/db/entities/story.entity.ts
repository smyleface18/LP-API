import { Column, Entity, OneToMany } from 'typeorm';
import { IsEnum, IsInt, IsNotEmpty, IsString } from 'class-validator';
import { CoreEntity } from './model.core';
import { Level } from '../enum/question.enum';
import { StoryPanel } from './story-panel.entity';
import { StoryParticipant } from './story-participant.entity';

/** Personaje del elenco, tal como quedó al terminar la historieta. */
export interface StoryCharacterRecord {
  id: string;
  name: string;
  kind: string;
  description: string;
  createdBy: string;
  introducedInPanel: number;
}

/**
 * Historieta terminada del modo Historieta (Fase 4c). El id es el `storyId`
 * que la partida recibe al empezar la generación de media, así el manifiesto
 * del review y el historial usan el mismo id.
 */
@Entity()
export class Story extends CoreEntity {
  /** Id de la partida en Redis (el código que compartieron los jugadores). */
  @IsString()
  @IsNotEmpty()
  @Column({ unique: true })
  gameId!: string;

  /** Título que puso la IA al terminar; null si no hubo (IA caída o historieta vieja). */
  @Column({ type: 'varchar', length: 80, nullable: true })
  title!: string | null;

  @IsEnum(Level)
  @Column({ type: 'enum', enum: Level })
  level!: Level;

  @IsString()
  @Column()
  language!: string;

  /** Viñetas configuradas (pueden haberse confirmado menos si la partida terminó antes). */
  @IsInt()
  @Column({ type: 'int' })
  panelsCount!: number;

  @Column({ type: 'jsonb', default: () => "'[]'" })
  characters!: StoryCharacterRecord[];

  @Column({ type: 'timestamptz' })
  finishedAt!: Date;

  @OneToMany(() => StoryPanel, (panel) => panel.story)
  panels!: StoryPanel[];

  @OneToMany(() => StoryParticipant, (participant) => participant.story)
  participants!: StoryParticipant[];
}
