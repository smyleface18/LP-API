import { Repository } from 'typeorm';
import { User } from '@/db/entities';
import { LockHandle } from '@/common/src/redis/redis-lock.service';
import { UniqueNamesAdapter } from '@/common/src/unique-names/unique-names.adapter';
import { StoryGameService } from './story-game.service';
import { StoryChanges, StoryStateRepository } from './story-state.repository';
import { StoryError, StoryErrorCode } from './domain/story-game.errors';
import { CharacterSheet, StoryGame, StorySnapshot, StoryStatus } from './domain/story-game.types';
import { Level } from '@/db/enum/question.enum';

/**
 * Redis en memoria con la misma interfaz que StoryStateRepository. Guarda JSON
 * (cada lectura es una copia, como en Redis) y serializa withGameLock.
 */
class InMemoryStoryStore {
  games = new Map<string, string>();
  userGames = new Map<string, string>();
  private queue: Promise<unknown> = Promise.resolve();

  get(gameId: string): Promise<StorySnapshot | null> {
    const raw = this.games.get(gameId);
    return Promise.resolve(raw ? (JSON.parse(raw) as StorySnapshot) : null);
  }

  create(game: StoryGame): Promise<boolean> {
    if (this.games.has(game.gameId)) return Promise.resolve(false);
    this.games.set(game.gameId, JSON.stringify({ game, characters: {} }));
    return Promise.resolve(true);
  }

  async save(gameId: string, _lock: LockHandle, changes: StoryChanges): Promise<void> {
    const snapshot = (await this.get(gameId))!;
    if (changes.game) snapshot.game = changes.game;
    Object.assign(snapshot.characters, changes.setCharacters);
    for (const userId of changes.deleteCharacters ?? []) delete snapshot.characters[userId];
    this.games.set(gameId, JSON.stringify(snapshot));
  }

  withGameLock<T>(gameId: string, fn: (lock: LockHandle) => Promise<T>): Promise<T> {
    const run = this.queue.then(() => fn({ key: `lock:${gameId}`, token: 't' }));
    this.queue = run.catch(() => undefined);
    return run;
  }

  setUserGame(userId: string, gameId: string): Promise<void> {
    this.userGames.set(userId, gameId);
    return Promise.resolve();
  }

  getUserGame(userId: string): Promise<string | null> {
    return Promise.resolve(this.userGames.get(userId) ?? null);
  }

  clearUserGame(userId: string, gameId: string): Promise<void> {
    if (this.userGames.get(userId) === gameId) this.userGames.delete(userId);
    return Promise.resolve();
  }
}

const SHEET: CharacterSheet = {
  name: 'Luna',
  type: 'girl',
  trait: 'curly red hair',
  clothing: 'a yellow raincoat',
  detail: 'carries a tiny robot',
};

async function expectStoryError(promise: Promise<unknown>, code: StoryErrorCode) {
  await expect(promise).rejects.toBeInstanceOf(StoryError);
  await promise.catch((error: StoryError) => expect(error.code).toBe(code));
}

describe('StoryGameService', () => {
  let store: InMemoryStoryStore;
  let service: StoryGameService;
  let nextName: number;

  beforeEach(() => {
    store = new InMemoryStoryStore();
    nextName = 0;
    const users = {
      findOne: jest.fn(({ where: { id } }: { where: { id: string } }) =>
        Promise.resolve(id === 'ghost' ? null : ({ id, username: `name-${id}` } as User)),
      ),
    } as unknown as Repository<User>;
    const uniqueNames = {
      NamesGenerator: () => `game-${++nextName}`,
    } as UniqueNamesAdapter;

    service = new StoryGameService(store as unknown as StoryStateRepository, users, uniqueNames);
  });

  /** Partida con `ids` en orden de entrada; el primero es el anfitrión. */
  async function lobbyWith(...ids: string[]): Promise<string> {
    const { game } = await service.createGame(ids[0]);
    for (const id of ids.slice(1)) await service.joinGame(game.gameId, id);
    return game.gameId;
  }

  async function playingWith(...ids: string[]): Promise<string> {
    const gameId = await lobbyWith(...ids);
    await service.startCharacters(gameId, ids[0]);
    for (const id of ids) await service.createCharacter(gameId, id, SHEET);
    await service.startStory(gameId, ids[0]);
    return gameId;
  }

  describe('lobby', () => {
    it('creates a LOBBY game with the creator as host and the default config', async () => {
      const { game } = await service.createGame('alice');

      expect(game.status).toBe(StoryStatus.LOBBY);
      expect(game.hostId).toBe('alice');
      expect(game.config).toEqual({
        panelsCount: 6,
        turnDurationSec: 90,
        level: Level.A2,
        language: 'en-US',
      });
      expect(game.players.map((player) => player.userId)).toEqual(['alice']);
      expect(await store.getUserGame('alice')).toBe(game.gameId);
    });

    it('retries with another id when the generated one is taken', async () => {
      store.games.set('game-1', '{}');
      const { game } = await service.createGame('alice');
      expect(game.gameId).toBe('game-2');
    });

    it('keeps players in join order', async () => {
      const gameId = await lobbyWith('alice', 'bob', 'carol');
      const snapshot = await service.getSnapshot(gameId);
      expect(snapshot.game.players.map((player) => player.userId)).toEqual([
        'alice',
        'bob',
        'carol',
      ]);
    });

    it('treats joining again as a reconnection without changing the order', async () => {
      const gameId = await lobbyWith('alice', 'bob');
      await service.disconnect(gameId, 'bob');

      const { game } = await service.joinGame(gameId, 'bob');
      expect(game.players.map((player) => [player.userId, player.connected])).toEqual([
        ['alice', true],
        ['bob', true],
      ]);
    });

    it('rejects a 7th player', async () => {
      const gameId = await lobbyWith('p1', 'p2', 'p3', 'p4', 'p5', 'p6');
      await expectStoryError(service.joinGame(gameId, 'p7'), 'GAME_FULL');
    });

    it('rejects joining after the lobby', async () => {
      const gameId = await lobbyWith('alice', 'bob');
      await service.startCharacters(gameId, 'alice');
      await expectStoryError(service.joinGame(gameId, 'carol'), 'INVALID_STATE');
    });

    it('rejects joining a game that does not exist', async () => {
      await expectStoryError(service.joinGame('nope', 'alice'), 'GAME_NOT_FOUND');
    });

    it('rejects an unknown user', async () => {
      await expectStoryError(service.createGame('ghost'), 'USER_NOT_FOUND');
    });

    it('does not let a user be in two active games', async () => {
      await lobbyWith('alice');
      const other = await lobbyWith('bob');
      await expectStoryError(service.createGame('alice'), 'ALREADY_IN_GAME');
      await expectStoryError(service.joinGame(other, 'alice'), 'ALREADY_IN_GAME');
    });

    it('lets a user start a new game once the previous one was abandoned', async () => {
      const first = await lobbyWith('alice');
      await service.disconnect(first, 'alice');
      const { game } = await service.createGame('alice');
      expect(game.gameId).not.toBe(first);
    });
  });

  describe('updateConfig', () => {
    it('lets the host change part of the config', async () => {
      const gameId = await lobbyWith('alice', 'bob');
      const { game } = await service.updateConfig(gameId, 'alice', {
        panelsCount: 8,
        turnDurationSec: undefined,
      });
      expect(game.config).toEqual({
        panelsCount: 8,
        turnDurationSec: 90,
        level: Level.A2,
        language: 'en-US',
      });
    });

    it('rejects a non-host', async () => {
      const gameId = await lobbyWith('alice', 'bob');
      await expectStoryError(service.updateConfig(gameId, 'bob', { panelsCount: 8 }), 'NOT_HOST');
    });

    it('rejects changes after the lobby', async () => {
      const gameId = await lobbyWith('alice', 'bob');
      await service.startCharacters(gameId, 'alice');
      await expectStoryError(
        service.updateConfig(gameId, 'alice', { panelsCount: 8 }),
        'INVALID_STATE',
      );
    });
  });

  describe('startCharacters', () => {
    it('moves the game to CHARACTERS', async () => {
      const gameId = await lobbyWith('alice', 'bob');
      const { game } = await service.startCharacters(gameId, 'alice');
      expect(game.status).toBe(StoryStatus.CHARACTERS);
    });

    it('rejects a non-host', async () => {
      const gameId = await lobbyWith('alice', 'bob');
      await expectStoryError(service.startCharacters(gameId, 'bob'), 'NOT_HOST');
    });

    it('needs at least 2 players', async () => {
      const gameId = await lobbyWith('alice');
      await expectStoryError(service.startCharacters(gameId, 'alice'), 'NOT_ENOUGH_PLAYERS');
    });
  });

  describe('characters', () => {
    it('stores one sheet per player and replaces it if created again', async () => {
      const gameId = await lobbyWith('alice', 'bob');
      await service.startCharacters(gameId, 'alice');
      await service.createCharacter(gameId, 'bob', SHEET);
      const { characters } = await service.createCharacter(gameId, 'bob', {
        ...SHEET,
        name: 'Max',
      });

      expect(Object.keys(characters)).toEqual(['bob']);
      expect(characters.bob.name).toBe('Max');
    });

    it('only keeps the sheet fields', async () => {
      const gameId = await lobbyWith('alice', 'bob');
      await service.startCharacters(gameId, 'alice');
      const { characters } = await service.createCharacter(gameId, 'bob', {
        ...SHEET,
        extra: 'x',
      } as CharacterSheet);
      expect(characters.bob).toEqual(SHEET);
    });

    it('rejects characters outside the CHARACTERS step', async () => {
      const gameId = await lobbyWith('alice', 'bob');
      await expectStoryError(service.createCharacter(gameId, 'bob', SHEET), 'INVALID_STATE');
    });

    it('rejects someone who is not a player', async () => {
      const gameId = await lobbyWith('alice', 'bob');
      await service.startCharacters(gameId, 'alice');
      await expectStoryError(service.createCharacter(gameId, 'carol', SHEET), 'NOT_A_PLAYER');
    });
  });

  describe('startStory', () => {
    it('cannot start while a player has no character', async () => {
      const gameId = await lobbyWith('alice', 'bob');
      await service.startCharacters(gameId, 'alice');
      await service.createCharacter(gameId, 'alice', SHEET);

      await expectStoryError(service.startStory(gameId, 'alice'), 'CHARACTERS_MISSING');
      expect((await service.getSnapshot(gameId)).game.status).toBe(StoryStatus.CHARACTERS);
    });

    it('rejects a non-host', async () => {
      const gameId = await lobbyWith('alice', 'bob');
      await service.startCharacters(gameId, 'alice');
      await service.createCharacter(gameId, 'alice', SHEET);
      await service.createCharacter(gameId, 'bob', SHEET);
      await expectStoryError(service.startStory(gameId, 'bob'), 'NOT_HOST');
    });

    it('moves to PLAYING at panel 0 when everyone has a character', async () => {
      const gameId = await playingWith('alice', 'bob');
      const { game } = await service.getSnapshot(gameId);
      expect(game.status).toBe(StoryStatus.PLAYING);
      expect(game.currentPanel).toBe(0);
    });

    it('cannot skip the characters step', async () => {
      const gameId = await lobbyWith('alice', 'bob');
      await expectStoryError(service.startStory(gameId, 'alice'), 'INVALID_STATE');
    });
  });

  describe('host hand-over and abandonment', () => {
    it('passes the host to the next player in order when the host disconnects', async () => {
      const gameId = await lobbyWith('alice', 'bob', 'carol');
      const snapshot = await service.disconnect(gameId, 'alice');
      expect(snapshot?.game.hostId).toBe('bob');
    });

    it('skips disconnected players and wraps around the order', async () => {
      const gameId = await lobbyWith('alice', 'bob', 'carol', 'dave');
      await service.disconnect(gameId, 'dave');
      await service.disconnect(gameId, 'alice'); // host → bob
      const snapshot = await service.disconnect(gameId, 'bob'); // → carol (dave offline)
      expect(snapshot?.game.hostId).toBe('carol');
    });

    it('does not give the host back when the old host reconnects', async () => {
      const gameId = await lobbyWith('alice', 'bob');
      await service.disconnect(gameId, 'alice');
      const snapshot = await service.resume('alice');
      expect(snapshot?.game.hostId).toBe('bob');
      expect(snapshot?.game.players[0].connected).toBe(true);
    });

    it('passes the host on when the host leaves the lobby', async () => {
      const gameId = await lobbyWith('alice', 'bob', 'carol');
      const { game } = await service.leaveGame(gameId, 'alice');
      expect(game.hostId).toBe('bob');
      expect(game.players.map((player) => player.userId)).toEqual(['bob', 'carol']);
      expect(await store.getUserGame('alice')).toBeNull();
    });

    it('removes the character of a player who leaves during CHARACTERS', async () => {
      const gameId = await lobbyWith('alice', 'bob', 'carol');
      await service.startCharacters(gameId, 'alice');
      await service.createCharacter(gameId, 'carol', SHEET);
      const { characters } = await service.leaveGame(gameId, 'carol');
      expect(characters).toEqual({});
    });

    it('keeps a player who leaves during PLAYING in the turn order', async () => {
      const gameId = await playingWith('alice', 'bob', 'carol');
      const { game } = await service.leaveGame(gameId, 'bob');
      expect(game.players.map((player) => [player.userId, player.left])).toEqual([
        ['alice', false],
        ['bob', true],
        ['carol', false],
      ]);
    });

    it('abandons the game when nobody is connected', async () => {
      const gameId = await playingWith('alice', 'bob');
      await service.disconnect(gameId, 'bob');
      const snapshot = await service.disconnect(gameId, 'alice');
      expect(snapshot?.game.status).toBe(StoryStatus.ABANDONED);
    });

    it('abandons the game when the last player leaves', async () => {
      const gameId = await lobbyWith('alice');
      const { game } = await service.leaveGame(gameId, 'alice');
      expect(game.status).toBe(StoryStatus.ABANDONED);
    });

    it('ignores the disconnect of someone who already left', async () => {
      const gameId = await lobbyWith('alice', 'bob');
      await service.leaveGame(gameId, 'bob');
      expect(await service.disconnect(gameId, 'bob')).toBeNull();
    });
  });

  describe('resume', () => {
    it('returns null when the user has no game', async () => {
      expect(await service.resume('alice')).toBeNull();
    });

    it('clears the reference to an abandoned game', async () => {
      const gameId = await lobbyWith('alice');
      await service.disconnect(gameId, 'alice');
      expect(await service.resume('alice')).toBeNull();
      expect(await store.getUserGame('alice')).toBeNull();
    });

    it('clears the reference to an expired game', async () => {
      await store.setUserGame('alice', 'expired');
      expect(await service.resume('alice')).toBeNull();
      expect(await store.getUserGame('alice')).toBeNull();
    });
  });

  it('serializes concurrent joins so nobody is lost', async () => {
    const gameId = await lobbyWith('p1');
    await Promise.all(['p2', 'p3', 'p4', 'p5', 'p6'].map((id) => service.joinGame(gameId, id)));
    const { game } = await service.getSnapshot(gameId);
    expect(game.players).toHaveLength(6);
  });
});
