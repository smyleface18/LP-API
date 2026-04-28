import { Entity, Column, OneToMany, ManyToMany, JoinTable, JoinColumn } from 'typeorm';
import { User } from './user.entity';
import { CoreEntity } from './model.core';
import { Level } from '../enum/question.enum';
import { Question } from './question.entity';
import { IsNotEmpty, IsUUID } from 'class-validator';
import { GameSession } from './game-session.entity';

@Entity()
export class Game extends CoreEntity {
  @Column({
    type: 'enum',
    enum: Level,
  })
  difficulty: Level;

  @ManyToMany(() => Question, (question) => question.games)
  @JoinTable()
  questions: Question[];

  @OneToMany(() => GameSession, (gameSession) => gameSession.game)
  sessions: GameSession[];
}
