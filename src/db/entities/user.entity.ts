import { Column, Entity, OneToMany } from 'typeorm';
import { CoreEntity, S3Object } from './model.core';
import { IsEmail, IsEnum } from 'class-validator';
import { Level } from '../enum/question.enum';
import { UserRoles } from '../enum/roles.enum';
import { GameSession } from './game-session.entity';

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

  @OneToMany(() => GameSession, (gameSession) => gameSession.user)
  gameSessions: GameSession[];
}
