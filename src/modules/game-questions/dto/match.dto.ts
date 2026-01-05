import { Game, User } from 'src/db/entities';

export class Match {
  private readonly users: User[];
  private readonly game: Game;

  constructor(users: User[], game: Game) {
    this.users = users;
    this.game = game;
  }

  sendQuestion() {
    return this.game.questions;
  }
}
