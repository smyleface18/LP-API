import { Question } from 'src/db/entities';
import { MatchStatus, ModeMatch, PlayerState } from './match.interface';
import { Level } from 'src/db/enum/question.enum';
import { v4 } from 'uuid';

export class Match {
  private readonly roomId: string;
  private players = new Map<string, PlayerState>();
  private currentQuestionIndex = 0;
  private status: MatchStatus = MatchStatus.WAITING;
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
      this.status = MatchStatus.FINISHED;
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

  toPersistence(): any {
    return {
      roomId: this.roomId,
      difficulty: this.difficulty,
      status: this.status,
      currentQuestionIndex: this.currentQuestionIndex,
      players: Array.from(this.players.entries()),
      questions: this.questions,
    };
  }

  static fromPersistence(data: unknown): Match {
    if (!data || typeof data !== 'object') {
      throw new Error('Invalid match snapshot: not an object');
    }

    const snapshot = data as Record<string, unknown>;

    // 🔎 Validar roomId
    if (typeof snapshot.roomId !== 'string' || snapshot.roomId.length === 0) {
      throw new Error('Invalid match snapshot: roomId');
    }

    // 🔎 Validar difficulty
    if (!Object.values(Level).includes(snapshot.difficulty as Level)) {
      throw new Error('Invalid match snapshot: difficulty');
    }

    // 🔎 Validar status
    const allowedStatus: MatchStatus[] = [
      MatchStatus.WAITING,
      MatchStatus.PLAYING,
      MatchStatus.FINISHED,
    ];
    if (!allowedStatus.includes(snapshot.status as MatchStatus)) {
      throw new Error('Invalid match snapshot: status');
    }

    // 🔎 Validar currentQuestionIndex
    if (typeof snapshot.currentQuestionIndex !== 'number' || snapshot.currentQuestionIndex < 0) {
      throw new Error('Invalid match snapshot: currentQuestionIndex');
    }

    // 🔎 Validar questions
    if (!Array.isArray(snapshot.questions)) {
      throw new Error('Invalid match snapshot: questions');
    }

    // 🔎 Validar players
    if (!Array.isArray(snapshot.players)) {
      throw new Error('Invalid match snapshot: players');
    }

    // Crear instancia
    const match = new Match(
      snapshot.difficulty as Level,
      ModeMatch.MULTIPLAYER,
      snapshot.questions as Question[],
    );

    // Restaurar estado
    match.status = snapshot.status as MatchStatus;
    match.currentQuestionIndex = snapshot.currentQuestionIndex;

    // Reconstruir Map de players
    const playersMap = new Map<string, PlayerState>();

    for (const entry of snapshot.players) {
      if (
        !Array.isArray(entry) ||
        entry.length !== 2 ||
        typeof entry[0] !== 'string' ||
        typeof entry[1] !== 'object'
      ) {
        throw new Error('Invalid match snapshot: malformed player entry');
      }

      const playerState = entry[1] as PlayerState;
      playersMap.set(entry[0], playerState);
    }

    match.players = playersMap;

    return match;
  }
}
