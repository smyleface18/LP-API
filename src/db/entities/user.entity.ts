import { Column, Entity, ManyToOne } from 'typeorm';
import { CoreEntity, S3Object } from './model.core';
import { UserGame } from './game.entity';
import { IsEmail, IsEnum } from 'class-validator';
import { Level } from '../enum/question.enum';

@Entity()
export class User extends CoreEntity {
  @Column()
  username: string;

  @IsEmail()
  @Column()
  email: string;

  @Column()
  score: number;

  @IsEnum(Level)
  @Column({
    type: 'enum',
    enum: Level,
  })
  level: Level;

  @Column({ type: 'json', nullable: true })
  avatar: S3Object;

  @ManyToOne(() => UserGame, (userGame) => userGame.user)
  userGames: UserGame;
}
