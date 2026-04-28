import { Entity, Column, OneToMany, ManyToMany, JoinTable } from 'typeorm';
import { CoreEntity } from './model.core';
import { Level } from '../enum/question.enum';
import { Question } from './question.entity';
import { IsEnum } from 'class-validator';
import { GameSession } from './game-session.entity';

@Entity()
export class Game extends CoreEntity {
  @IsEnum(Level)
  @Column({
    type: 'enum',
    enum: Level,
  })
  difficulty!: Level;

  @ManyToMany(() => Question, (question) => question.games)
  @JoinTable()
  questions!: Question[];

  @OneToMany(() => GameSession, (gameSession) => gameSession.game)
  sessions!: GameSession[];
}
