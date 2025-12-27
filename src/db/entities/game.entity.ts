import { Entity, Column, OneToMany, ManyToOne, ManyToMany, JoinTable } from 'typeorm';
import { User } from './user.entity';
import { CoreEntity } from './model.core';
import { LevelCategoryQuestion } from '../enum/question.enum';
import { Question } from './question.entity';

@Entity()
export class Game extends CoreEntity {
  @Column({
    type: 'enum',
    enum: LevelCategoryQuestion,
  })
  difficulty: LevelCategoryQuestion;

  @ManyToMany(() => Question, (question) => question.games)
  @JoinTable()
  questions: Question[];

  @OneToMany(() => UserGame, (userGame) => userGame.game)
  userGames: UserGame[];
}

@Entity()
export class UserGame extends CoreEntity {
  @ManyToOne(() => User, (user) => user.userGames)
  user: User;

  @ManyToOne(() => Game, (game) => game.userGames)
  game: Game;

  @Column()
  score: number;

  @Column()
  completedAt: Date;
}
