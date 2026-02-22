import { Entity, Column, OneToMany, ManyToOne, ManyToMany, JoinTable, JoinColumn } from 'typeorm';
import { User } from './user.entity';
import { CoreEntity } from './model.core';
import { Level } from '../enum/question.enum';
import { Question } from './question.entity';
import { IsNotEmpty, IsUUID } from 'class-validator';

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

  @OneToMany(() => UserGame, (userGame) => userGame.game)
  userGames: UserGame[];
}

@Entity()
export class UserGame extends CoreEntity {
  @ManyToOne(() => User, (user) => user.userGames)
  @JoinColumn({
    name: 'user_id',
  })
  user: User;

  @IsNotEmpty()
  @IsUUID()
  @Column({ name: 'user_id', type: 'uuid' })
  userId: string;

  @ManyToOne(() => Game, (game) => game.userGames)
  @JoinColumn({
    name: 'game_id',
  })
  game: Game;

  @IsNotEmpty()
  @IsUUID()
  @Column({
    name: 'game_id',
    type: 'uuid',
  })
  gameId: string;

  @Column()
  score: number;

  @Column({ type: 'int', nullable: true })
  position: number;
}
