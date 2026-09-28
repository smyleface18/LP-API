import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { CoreEntity } from './model.core';
import { Story } from './story.entity';
import { User } from './user.entity';
import { StoryModerationAction, StoryRemovalReason } from '../enum/story.enum';

/**
 * Historial de moderación de una historieta: una fila por cada vez que un
 * admin la quitó o la restauró. `story` guarda solo el estado actual; esto
 * conserva quién hizo qué, cuándo y por qué aunque después se restaure.
 */
@Entity()
@Index(['storyId', 'createdAt'])
export class StoryModerationLog extends CoreEntity {
  @ManyToOne(() => Story, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'story_id' })
  story!: Story;

  @Column({ name: 'story_id', type: 'uuid' })
  storyId!: string;

  @Column({ type: 'enum', enum: StoryModerationAction })
  action!: StoryModerationAction;

  /** Admin que actuó. Si ese usuario se borra, queda null (se conserva el resto). */
  @ManyToOne(() => User, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'admin_id' })
  admin!: User | null;

  @Column({ name: 'admin_id', type: 'uuid', nullable: true })
  adminId!: string | null;

  /** Motivo (solo al quitar). */
  @Column({ type: 'enum', enum: StoryRemovalReason, nullable: true })
  reason!: StoryRemovalReason | null;

  @Column({ type: 'varchar', length: 500, nullable: true })
  note!: string | null;
}
