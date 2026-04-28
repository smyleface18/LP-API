import { Entity, Column, ManyToOne, JoinColumn } from 'typeorm';
import { CoreEntity } from './model.core';
import { GameSession } from './game-session.entity';
import { Question } from './question.entity';
import { QuestionOption } from './question-option.entity';
import { IsNotEmpty, IsUUID } from 'class-validator';

@Entity()
export class PlayerAnswer extends CoreEntity {
  @ManyToOne(() => GameSession, (gameSession) => gameSession.answers)
  @JoinColumn({ name: 'game_session_id' })
  gameSession: GameSession;

  @IsNotEmpty()
  @IsUUID()
  @Column({ name: 'game_session_id', type: 'uuid' })
  gameSessionId: string;

  @ManyToOne(() => Question)
  @JoinColumn({ name: 'question_id' })
  question: Question;

  @IsNotEmpty()
  @IsUUID()
  @Column({ name: 'question_id', type: 'uuid' })
  questionId: string;

  @ManyToOne(() => QuestionOption)
  @JoinColumn({ name: 'selected_option_id' })
  selectedOption: QuestionOption;

  @IsNotEmpty()
  @IsUUID()
  @Column({ name: 'selected_option_id', type: 'uuid' })
  selectedOptionId: string;

  @Column()
  isCorrect: boolean;

  @Column({ type: 'int' })
  timeTaken: number; // en segundos
}
