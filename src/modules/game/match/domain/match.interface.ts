export interface PlayerState {
  userId: string;
  score: number;
  isConnected: boolean;
}

export enum ModeMatch {
  SINGLEPLAYER = 'SINGLEPLAYER',
  MULTIPLAYER = 'MULTIPLAYER',
}
