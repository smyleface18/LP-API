import { CharacterSheet, StoryConfig, StorySnapshot, StoryStatus } from './story-game.types';

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
    hasCharacter: boolean;
  }[];
}

/** Payload de `charactersUpdated`. */
export interface CharactersView {
  gameId: string;
  characters: ({ userId: string; username: string } & CharacterSheet)[];
  /** Jugadores activos que todavía no crearon su personaje. */
  missing: string[];
}

export function toLobbyView({ game, characters }: StorySnapshot): LobbyView {
  return {
    gameId: game.gameId,
    status: game.status,
    hostId: game.hostId,
    config: game.config,
    players: game.players.map((player) => ({
      userId: player.userId,
      username: player.username,
      connected: player.connected,
      left: player.left,
      hasCharacter: Boolean(characters[player.userId]),
    })),
  };
}

export function toCharactersView({ game, characters }: StorySnapshot): CharactersView {
  return {
    gameId: game.gameId,
    characters: game.players
      .filter((player) => characters[player.userId])
      .map((player) => ({
        userId: player.userId,
        username: player.username,
        ...characters[player.userId],
      })),
    missing: game.players
      .filter((player) => !player.left && !characters[player.userId])
      .map((player) => player.userId),
  };
}
