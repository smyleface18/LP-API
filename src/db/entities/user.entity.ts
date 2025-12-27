import { Column, Entity, ManyToOne } from 'typeorm';
import { CoreEntity, S3Object } from './model.core';
import { GameQuestion } from './game-question.entity';
import { IsEmail } from 'class-validator';

@Entity()
export class User extends CoreEntity {
  @Column()
  username: string;

  @IsEmail()
  @Column()
  email: string;

  @Column()
  score: number;

  @Column({ type: 'json', nullable: true })
  avatar: S3Object;

  @ManyToOne(() => GameQuestion, (gameQuestion) => gameQuestion.users)
  gameQuestion: GameQuestion;
}
