import { Column, Entity, Index, JoinColumn, ManyToOne, OneToMany } from 'typeorm';
import { IsEnum, IsInt, IsNotEmpty, IsString } from 'class-validator';
import { CoreEntity } from './model.core';
import { Level } from '../enum/question.enum';
import { StoryRemovalReason, StoryVisibility } from '../enum/story.enum';
import { StoryPanel } from './story-panel.entity';
import { StoryParticipant } from './story-participant.entity';
import { User } from './user.entity';

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
 *
 * Quiénes la crearon: `participants` (los jugadores, con su puesto) y el
 * `author` de cada viñeta en `panels`.
 *
 * Moderación: un admin puede quitarla (`visibility = REMOVED`). No se borra
 * la fila (queda para auditoría, con quién, cuándo y por qué), pero deja de
 * aparecer en el catálogo y en el historial de los jugadores.
 */
@Entity()
@Index(['visibility', 'finishedAt'])
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

  /** Publicada (catálogo e historial) o quitada por un admin. */
  @IsEnum(StoryVisibility)
  @Column({ type: 'enum', enum: StoryVisibility, default: StoryVisibility.PUBLISHED })
  visibility!: StoryVisibility;

  /** Cuándo la quitó un admin; null si está publicada. */
  @Column({ type: 'timestamptz', nullable: true })
  removedAt!: Date | null;

  /** Admin que la quitó. Si ese usuario se borra, queda null (se conserva el resto). */
  @ManyToOne(() => User, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'removed_by_id' })
  removedBy!: User | null;

  @Column({ name: 'removed_by_id', type: 'uuid', nullable: true })
  removedById!: string | null;

  @Column({ type: 'enum', enum: StoryRemovalReason, nullable: true })
  removalReason!: StoryRemovalReason | null;

  /** Detalle del admin (obligatorio con el motivo OTHER). */
  @Column({ type: 'varchar', length: 500, nullable: true })
  removalNote!: string | null;
}
