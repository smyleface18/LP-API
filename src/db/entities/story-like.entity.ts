import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { CoreEntity } from './model.core';
import { Story } from './story.entity';
import { User } from './user.entity';

/**
 * "Me gusta" de un usuario a una historieta completa: una fila por usuario y
 * historieta (dar like dos veces no suma). Se borra con la historieta o la cuenta.
 */
@Entity()
@Index(['storyId', 'userId'], { unique: true })
export class StoryLike extends CoreEntity {
  @ManyToOne(() => Story, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'story_id' })
  story!: Story;

  @Column({ name: 'story_id', type: 'uuid' })
  storyId!: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user!: User;

  @Column({ name: 'user_id', type: 'uuid' })
  userId!: string;
}
