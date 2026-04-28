import { Entity, Column, ManyToOne, JoinColumn, OneToMany } from 'typeorm';
import { CoreEntity } from './model.core';
import { User } from './user.entity';
import { Game } from './game.entity';
import { PlayerAnswer } from './player-answer.entity';
import { IsNotEmpty, IsUUID } from 'class-validator';

@Entity()
export class GameSession extends CoreEntity {
  @ManyToOne(() => User, (user) => user.gameSessions)
  @JoinColumn({ name: 'user_id' })
  user: User;

  @IsNotEmpty()
  @IsUUID()
  @Column({ name: 'user_id', type: 'uuid' })
  userId: string;

  @ManyToOne(() => Game, (game) => game.sessions)
  @JoinColumn({ name: 'game_id' })
  game: Game;

  @IsNotEmpty()
  @IsUUID()
  @Column({ name: 'game_id', type: 'uuid' })
  gameId: string;

  @Column()
  score: number;

  @Column({ type: 'int', nullable: true })
  position: number;

  @OneToMany(() => PlayerAnswer, (playerAnswer) => playerAnswer.gameSession)
  answers: PlayerAnswer[];
}
