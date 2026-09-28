import { Column, Entity, Index, JoinColumn, ManyToOne, Unique } from 'typeorm';
import { IsBoolean, IsInt, IsNumber, IsString, IsUUID } from 'class-validator';
import { CoreEntity } from './model.core';
import { Story } from './story.entity';
import { User } from './user.entity';

/**
 * Jugador de una historieta terminada, con su puesto en el ranking. Define
 * quién ve la historieta en su historial.
 */
@Entity()
@Unique(['storyId', 'userId'])
export class StoryParticipant extends CoreEntity {
  @ManyToOne(() => Story, (story) => story.participants, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'story_id' })
  story!: Story;

  @IsUUID()
  @Column({ name: 'story_id', type: 'uuid' })
  storyId!: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user!: User;

  /** Índice: el historial de un jugador se busca por acá. */
  @IsUUID()
  @Index()
  @Column({ name: 'user_id', type: 'uuid' })
  userId!: string;

  /** Nombre cuando jugó. */
  @IsString()
  @Column()
  username!: string;

  /** Puesto en el ranking (1 = primero), por promedio por viñeta. */
  @IsInt()
  @Column({ type: 'int' })
  position!: number;

  @IsInt()
  @Column({ type: 'int' })
  panelsWritten!: number;

  @IsInt()
  @Column({ type: 'int' })
  totalScore!: number;

  @IsNumber()
  @Column({ type: 'real' })
  averageScore!: number;

  /** Salió de la partida antes de que terminara. */
  @IsBoolean()
  @Column({ default: false })
  left!: boolean;
}
