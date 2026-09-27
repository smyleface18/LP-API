import { StoryConfig, StorySnapshot, StoryStatus } from './story-game.types';

/** Payload de `lobbyUpdated`. */
export interface LobbyView {
  gameId: string;
  status: StoryStatus;
  hostId: string;
  config: StoryConfig;
  players: {
    userId: string;
    username: string;
    connected: boolean;
    left: boolean;
  }[];
}

export function toLobbyView({ game }: StorySnapshot): LobbyView {
  return {
    gameId: game.gameId,
    status: game.status,
    hostId: game.hostId,
    config: game.config,
    players: game.players.map(({ userId, username, connected, left }) => ({
      userId,
      username,
      connected,
      left,
    })),
  };
}
