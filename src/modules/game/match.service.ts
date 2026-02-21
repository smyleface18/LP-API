import { Game, Question, User } from 'src/db/entities';
import { ModeMatch, PlayerState } from './dto/match.types';
import { Injectable, NotFoundException } from '@nestjs/common';
import { v4 } from 'uuid';

export class Match {
  private readonly roomId: string;
  private readonly game: Game;
  private players = new Map<string, PlayerState>();
  private currentQuestionIndex = 0;
  private status: 'waiting' | 'playing' | 'finished' = 'waiting';

  constructor(game: Game, roomId: string) {
    this.game = game;
    this.roomId = roomId;
  }

  getRoomId(): string {
    return this.roomId;
  }

  addPlayer(user: User) {
    if (this.players.has(user.id)) return;

    this.players.set(user.id, {
      user,
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
    if (this.currentQuestionIndex >= this.game.questions.length) {
      this.status = 'finished';
      return null;
    }

    const question = this.game.questions[this.currentQuestionIndex];
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
      userId: p.user.id,
      score: p.score,
    }));
  }

  getStatus() {
    return this.status;
  }
}

@Injectable()
export class MatchService {
  // roomId -> Match
  private matches = new Map<string, Match>();

  // userId -> roomId
  private userMatchIndex = new Map<string, string>();

  // ================================
  // Crear partida (solo o friend)
  // ================================
  createMatch(game: Game, user: User, mode: ModeMatch): Match {
    let roomId = '';
    switch (mode) {
      case ModeMatch.MULTIPLAYER:
        roomId = v4();
        break;
      case ModeMatch.SINGLEPLAYER:
        roomId = v4();
        break;
    }

    const match = new Match(game, roomId);

    match.addPlayer(user);

    this.matches.set(roomId, match);
    this.userMatchIndex.set(user.id, roomId);

    return match;
  }

  // ================================
  // Unirse a partida existente
  // ================================
  joinMatch(roomId: string, user: User): Match {
    const match = this.matches.get(roomId);

    if (!match) {
      throw new NotFoundException('Match not found');
    }

    match.addPlayer(user);
    this.userMatchIndex.set(user.id, roomId);

    return match;
  }

  // ================================
  // Obtener match por usuario
  // ================================
  getMatchByUser(userId: string): Match | undefined {
    const roomId = this.userMatchIndex.get(userId);
    if (!roomId) return undefined;

    return this.matches.get(roomId);
  }

  // ================================
  // Desconectar jugador
  // ================================
  disconnectUser(userId: string) {
    const match = this.getMatchByUser(userId);
    if (!match) return;

    match.disconnectPlayer(userId);
  }

  // ================================
  // Reconectar jugador
  // ================================
  reconnectUser(userId: string) {
    const match = this.getMatchByUser(userId);
    if (!match) return;

    match.reconnectPlayer(userId);
  }

  // ================================
  // Finalizar partida
  // ================================
  finishMatch(roomId: string) {
    const match = this.matches.get(roomId);
    if (!match) return;

    const results = match.getResults();

    // Aquí puedes persistir resultados en DB

    // Limpieza en memoria
    this.matches.delete(roomId);

    results.forEach((r) => {
      this.userMatchIndex.delete(r.userId);
    });

    return results;
  }

  // ================================
  // Obtener match por roomId
  // ================================
  getMatch(roomId: string): Match | undefined {
    return this.matches.get(roomId);
  }
}
