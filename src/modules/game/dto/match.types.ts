import { User } from 'src/db/entities';

export interface PlayerState {
  user: User;
  score: number;
  isConnected: boolean;
}

export enum ModeMatch {
  SINGLEPLAYER = 'SINGLEPLAYER',
  MULTIPLAYER = 'MULTIPLAYER',
}
