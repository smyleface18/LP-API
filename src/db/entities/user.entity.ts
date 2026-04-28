import { Column, Entity, OneToMany } from 'typeorm';
import { CoreEntity, S3Object } from './model.core';
import {
  IsEmail,
  IsEnum,
  IsNotEmpty,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
} from 'class-validator';
import { Level } from '../enum/question.enum';
import { UserRoles } from '../enum/roles.enum';
import { GameSession } from './game-session.entity';

@Entity()
export class User extends CoreEntity {
  @IsString()
  @IsNotEmpty()
  @Column()
  username!: string;

  @IsEmail()
  @Column()
  email!: string;

  @IsNumber()
  @Column({
    type: 'int',
    default: 0,
  })
  score!: number;

  @IsEnum(UserRoles)
  @Column({
    type: 'enum',
    enum: UserRoles,
    default: UserRoles.PLAYER,
  })
  userRole!: UserRoles;

  @IsEnum(Level)
  @Column({
    type: 'enum',
    enum: Level,
    default: Level.A1,
  })
  level!: Level;

  @IsOptional()
  @IsObject()
  @Column({ type: 'json', nullable: true })
  avatar!: S3Object;

  @OneToMany(() => GameSession, (gameSession) => gameSession.user)
  gameSessions!: GameSession[];
}
