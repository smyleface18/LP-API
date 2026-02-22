import { Question } from 'src/db/entities';
import { ModeMatch, PlayerState } from './match.interface';
import { Level } from 'src/db/enum/question.enum';
import { v4 } from 'uuid';

export class Match {
  private readonly roomId: string;
  private players = new Map<string, PlayerState>();
  private currentQuestionIndex = 0;
  private status: 'waiting' | 'playing' | 'finished' = 'waiting';
  private questions: Question[];
  private readonly difficulty: Level;

  constructor(difficulty: Level, mode: ModeMatch, questions: Question[]) {
    this.difficulty = difficulty;
    let roomId = '';
    switch (mode) {
      case ModeMatch.MULTIPLAYER:
        roomId = v4();
        break;
      case ModeMatch.SINGLEPLAYER:
        roomId = v4();
        break;
    }
    this.roomId = roomId;
    this.questions = questions;
  }

  getRoomId(): string {
    return this.roomId;
  }
  addPlayer(userId: string) {
    if (this.players.has(userId)) return;

    this.players.set(userId, {
      userId: userId,
      score: 0,
      isConnected: true,
    });
  }

  disconnectPlayer(userId: string) {
    const player = this.players.get(userId);
    if (player) {
      player.isConnected = false;
    }
  }

  reconnectPlayer(userId: string) {
    const player = this.players.get(userId);
    if (player) {
      player.isConnected = true;
    }
  }

  isUserConnected(userId: string): boolean {
    return this.players.get(userId)?.isConnected ?? false;
  }

  getPlayersCount(): number {
    return this.players.size;
  }

  sendNextQuestion(): Question | null {
    if (this.currentQuestionIndex >= this.questions.length) {
      this.status = 'finished';
      return null;
    }

    const question = this.questions[this.currentQuestionIndex];
    this.currentQuestionIndex++;

    return question;
  }

  addScore(userId: string, points: number) {
    const player = this.players.get(userId);
    if (player) {
      player.score += points;
    }
  }

  getResults() {
    return Array.from(this.players.values()).map((p) => ({
      userId: p.userId,
      score: p.score,
    }));
  }

  getStatus() {
    return this.status;
  }
}
