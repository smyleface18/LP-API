import { Column, Entity, JoinColumn, ManyToOne } from 'typeorm';
import { CoreEntity, S3Object } from './model.core';
import { UserGame } from './game.entity';
import { IsEmail, IsEnum } from 'class-validator';
import { Level } from '../enum/question.enum';
import { UserRoles } from '../enum/roles.enum';

@Entity()
export class User extends CoreEntity {
  @Column()
  username: string;

  @IsEmail()
  @Column()
  email: string;

  @Column({
    type: 'int',
    default: 0,
  })
  score: number;

  @Column({
    type: 'enum',
    enum: UserRoles,
    default: UserRoles.PLAYER,
  })
  userRole: UserRoles;

  @IsEnum(Level)
  @Column({
    type: 'enum',
    enum: Level,
    default: Level.A1,
  })
  level: Level;

  @Column({ type: 'json', nullable: true })
  avatar: S3Object;

  @ManyToOne(() => UserGame, (userGame) => userGame.user)
  @JoinColumn({ name: 'user_games_id' }) // nombre exacto de la columna en la DB
  userGames: UserGame;
}
