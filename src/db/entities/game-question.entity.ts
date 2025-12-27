import { Entity, Column, OneToMany } from 'typeorm';
import { User } from './user.entity';
import { CoreEntity } from './model.core';

@Entity()
export class GameQuestion extends CoreEntity {
  @Column()
  question: string;

  @Column()
  difficulty: string;

  @Column({ nullable: true })
  category?: string;

  @OneToMany(() => User, (user) => user.gameQuestion)
  users: User[];
}
