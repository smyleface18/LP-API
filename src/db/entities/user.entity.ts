import { Column, Entity, JoinColumn, ManyToOne, OneToMany } from 'typeorm';
import { CoreEntity } from './model.core';
import {
  IsEmail,
  IsEnum,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
} from 'class-validator';
import { Level } from '../enum/question.enum';
import { UserRoles } from '../enum/roles.enum';
import { GameSession } from './game-session.entity';
import { MediaAsset } from './media-asset.entity';

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

  @ManyToOne(() => MediaAsset, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'avatar_id' })
  avatar?: MediaAsset;

  @IsOptional()
  @IsUUID()
  @Column({ name: 'avatar_id', type: 'uuid', nullable: true })
  avatarId?: string;

  @OneToMany(() => GameSession, (gameSession) => gameSession.user)
  gameSessions!: GameSession[];
}
