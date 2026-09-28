import { Level } from '@/db/enum/question.enum';
import { StoryGameService } from './story-game.service';
import { StoryStatus } from './domain/story-game.types';
import { IDLE_ABANDON_DELAY_MS } from './story-game.config';
import { STORY_CANCEL_EVENT, STORY_SCHEDULE_EVENT } from './queue/type';
import {
  createStoryHarness,
  expectStoryError,
  InMemoryStoryStore,
} from '../../../test/story-game/story-harness';

describe('StoryGameService', () => {
  const T0 = 1_800_000_000_000;
  let clock: { now: number };
  let store: InMemoryStoryStore;
  let service: StoryGameService;
  let lobbyWith: (...ids: string[]) => Promise<string>;
  let playingWith: (...ids: string[]) => Promise<string>;
  let gameOf: ReturnType<typeof createStoryHarness>['gameOf'];
  let scheduled: ReturnType<typeof createStoryHarness>['scheduled'];
  let cancelled: ReturnType<typeof createStoryHarness>['cancelled'];

  beforeEach(() => {
    ({ clock, store, service, lobbyWith, playingWith, gameOf, scheduled, cancelled } =
      createStoryHarness(T0));
  });

  afterEach(() => jest.restoreAllMocks());

  /** Lleva la partida a un estado de fases posteriores (todavía sin transición propia). */
  async function forceStatus(gameId: string, status: StoryStatus) {
    await store.patch(gameId, (snapshot) => {
      snapshot.game.status = status;
    });
  }

  describe('lobby', () => {
    it('creates a LOBBY game with the creator as host and the default config', async () => {
      const { game, characters } = await service.createGame('alice');

      expect(game.status).toBe(StoryStatus.LOBBY);
      expect(game.hostId).toBe('alice');
      expect(game.config).toEqual({
        panelsCount: 6,
        turnDurationSec: 90,
        level: Level.A2,
        language: 'en-US',
        shareDrafts: true,
      });
      expect(game.players.map((player) => player.userId)).toEqual(['alice']);
      expect(characters).toEqual({});
      expect(await store.getUserGame('alice')).toBe(game.gameId);
    });

    it('retries with another id when the generated one is taken', async () => {
      store.games.set('game-1', '{}');
      const { game } = await service.createGame('alice');
      expect(game.gameId).toBe('game-2');
    });

    it('keeps players in join order', async () => {
      const gameId = await lobbyWith('alice', 'bob', 'carol');
      expect((await gameOf(gameId)).players.map((player) => player.userId)).toEqual([
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

    it('rejects new players after the story started', async () => {
      const gameId = await playingWith('alice', 'bob');
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

    it('lets a user start a new game once they left the previous one', async () => {
      const first = await lobbyWith('alice', 'bob');
      await service.leaveGame(first, 'alice');
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
        shareDrafts: true,
      });
    });

    it('rejects a non-host', async () => {
      const gameId = await lobbyWith('alice', 'bob');
      await expectStoryError(service.updateConfig(gameId, 'bob', { panelsCount: 8 }), 'NOT_HOST');
    });

    it('rejects changes after the story started', async () => {
      const gameId = await playingWith('alice', 'bob');
      await expectStoryError(
        service.updateConfig(gameId, 'alice', { panelsCount: 8 }),
        'INVALID_STATE',
      );
    });
  });

  describe('kickPlayer', () => {
    it('removes the player and clears their active game', async () => {
      const gameId = await lobbyWith('alice', 'bob', 'carol');
      const { game } = await service.kickPlayer(gameId, 'alice', 'bob');

      expect(game.players.map((player) => player.userId)).toEqual(['alice', 'carol']);
      expect(await store.getUserGame('bob')).toBeNull();
    });

    it('lets the kicked player join another game right away', async () => {
      const gameId = await lobbyWith('alice', 'bob');
      await service.kickPlayer(gameId, 'alice', 'bob');
      await expect(service.createGame('bob')).resolves.toBeDefined();
    });

    it('rejects a non-host', async () => {
      const gameId = await lobbyWith('alice', 'bob', 'carol');
      await expectStoryError(service.kickPlayer(gameId, 'bob', 'carol'), 'NOT_HOST');
    });

    it('rejects kicking yourself', async () => {
      const gameId = await lobbyWith('alice', 'bob');
      await expectStoryError(service.kickPlayer(gameId, 'alice', 'alice'), 'CANNOT_KICK_SELF');
    });

    it('rejects kicking someone who is not in the game', async () => {
      const gameId = await lobbyWith('alice', 'bob');
      await expectStoryError(service.kickPlayer(gameId, 'alice', 'zoe'), 'NOT_A_PLAYER');
    });

    it('only works in the lobby', async () => {
      const gameId = await playingWith('alice', 'bob');
      await expectStoryError(service.kickPlayer(gameId, 'alice', 'bob'), 'INVALID_STATE');
    });
  });

  describe('startStory', () => {
    it('moves from LOBBY to PLAYING at panel 0', async () => {
      const gameId = await playingWith('alice', 'bob');
      const game = await gameOf(gameId);
      expect(game.status).toBe(StoryStatus.PLAYING);
      expect(game.currentPanel).toBe(0);
    });

    it('rejects a non-host', async () => {
      const gameId = await lobbyWith('alice', 'bob');
      await expectStoryError(service.startStory(gameId, 'bob'), 'NOT_HOST');
    });

    it('lets a single player start a solo story', async () => {
      const gameId = await lobbyWith('alice');
      await service.startStory(gameId, 'alice');
      expect((await gameOf(gameId)).status).toBe(StoryStatus.PLAYING);
    });

    it('needs at least one panel per player', async () => {
      const gameId = await lobbyWith('p1', 'p2', 'p3', 'p4', 'p5');
      await service.updateConfig(gameId, 'p1', { panelsCount: 4 });

      await expectStoryError(service.startStory(gameId, 'p1'), 'NOT_ENOUGH_PANELS');
      expect((await gameOf(gameId)).status).toBe(StoryStatus.LOBBY);
    });

    it('counts disconnected lobby players for the panel check (they get turns too)', async () => {
      const gameId = await lobbyWith('p1', 'p2', 'p3', 'p4', 'p5');
      await service.updateConfig(gameId, 'p1', { panelsCount: 4 });
      await service.disconnect(gameId, 'p5');
      await expectStoryError(service.startStory(gameId, 'p1'), 'NOT_ENOUGH_PANELS');
    });

    it('accepts panelsCount equal to the number of players', async () => {
      const gameId = await lobbyWith('p1', 'p2', 'p3', 'p4');
      await service.updateConfig(gameId, 'p1', { panelsCount: 4 });
      const { game } = await service.startStory(gameId, 'p1');
      expect(game.status).toBe(StoryStatus.PLAYING);
    });

    it('cannot start twice', async () => {
      const gameId = await playingWith('alice', 'bob');
      await expectStoryError(service.startStory(gameId, 'alice'), 'INVALID_STATE');
    });
  });

  describe('host hand-over', () => {
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

    it('gives the host to whoever reconnects first after everyone dropped', async () => {
      const gameId = await lobbyWith('alice', 'bob');
      await service.disconnect(gameId, 'bob');
      await service.disconnect(gameId, 'alice'); // nadie conectado: alice sigue de anfitriona
      const snapshot = await service.resume('bob');
      expect(snapshot?.game.hostId).toBe('bob');
    });

    it('passes the host on when the host leaves the lobby', async () => {
      const gameId = await lobbyWith('alice', 'bob', 'carol');
      const { game } = await service.leaveGame(gameId, 'alice');
      expect(game.hostId).toBe('bob');
      expect(game.players.map((player) => player.userId)).toEqual(['bob', 'carol']);
      expect(await store.getUserGame('alice')).toBeNull();
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

    it('ignores the disconnect of someone who already left', async () => {
      const gameId = await lobbyWith('alice', 'bob');
      await service.leaveGame(gameId, 'bob');
      expect(await service.disconnect(gameId, 'bob')).toBeNull();
    });
  });

  describe('abandonment', () => {
    it('waits 60 s before abandoning an empty lobby and schedules the job', async () => {
      const gameId = await lobbyWith('alice', 'bob');
      await service.disconnect(gameId, 'bob');
      const snapshot = await service.disconnect(gameId, 'alice');

      expect(snapshot?.game.status).toBe(StoryStatus.LOBBY);
      expect(snapshot?.game.abandonAt).toBe(T0 + IDLE_ABANDON_DELAY_MS);
      expect(scheduled('abandon-idle')).toEqual([
        [
          STORY_SCHEDULE_EVENT,
          { gameId, kind: 'abandon-idle', seq: 1, dueAt: T0 + IDLE_ABANDON_DELAY_MS },
        ],
      ]);

      clock.now += IDLE_ABANDON_DELAY_MS;
      await service.abandonIdleGame(gameId, 1);
      expect((await gameOf(gameId)).status).toBe(StoryStatus.ABANDONED);
    });

    it('cancels the pending abandon when someone reconnects', async () => {
      const gameId = await lobbyWith('alice');
      await service.disconnect(gameId, 'alice');

      clock.now += 30_000;
      const snapshot = await service.resume('alice');
      expect(snapshot?.game.abandonAt).toBeNull();
      expect(cancelled('abandon-idle')).toEqual([
        [
          STORY_CANCEL_EVENT,
          { gameId, kind: 'abandon-idle', seq: 1, dueAt: T0 + IDLE_ABANDON_DELAY_MS },
        ],
      ]);

      // Aunque la tarea corra igual (no se pudo borrar), está obsoleta.
      clock.now = T0 + IDLE_ABANDON_DELAY_MS;
      await service.abandonIdleGame(gameId, 1);
      expect((await gameOf(gameId)).status).toBe(StoryStatus.LOBBY);
    });

    it('ignores an old job when the lobby emptied again later', async () => {
      const gameId = await lobbyWith('alice');
      await service.disconnect(gameId, 'alice'); // seq 1
      await service.resume('alice');
      clock.now += 10_000;
      await service.disconnect(gameId, 'alice'); // seq 2, vence más tarde

      clock.now = T0 + IDLE_ABANDON_DELAY_MS;
      await service.abandonIdleGame(gameId, 1);
      expect((await gameOf(gameId)).status).toBe(StoryStatus.LOBBY);

      clock.now = T0 + 10_000 + IDLE_ABANDON_DELAY_MS;
      await service.abandonIdleGame(gameId, 2);
      expect((await gameOf(gameId)).status).toBe(StoryStatus.ABANDONED);
    });

    it('a new player joining an empty lobby cancels the abandon and becomes host', async () => {
      const gameId = await lobbyWith('alice');
      await service.disconnect(gameId, 'alice');
      const { game } = await service.joinGame(gameId, 'bob');

      expect(game.abandonAt).toBeNull();
      expect(game.hostId).toBe('bob');
    });

    it('abandons right away when the last lobby player leaves', async () => {
      const gameId = await lobbyWith('alice');
      const { game } = await service.leaveGame(gameId, 'alice');
      expect(game.status).toBe(StoryStatus.ABANDONED);
      expect(scheduled('abandon-idle')).toHaveLength(0);
    });

    it('waits when the last connected player leaves but disconnected ones remain', async () => {
      const gameId = await lobbyWith('alice', 'bob');
      await service.disconnect(gameId, 'bob');
      const { game } = await service.leaveGame(gameId, 'alice');
      expect(game.status).toBe(StoryStatus.LOBBY);
      expect(scheduled('abandon-idle')).toHaveLength(1);
    });

    it('gives a PLAYING game the same 60 s margin', async () => {
      const gameId = await playingWith('alice', 'bob');
      await service.disconnect(gameId, 'bob');
      const snapshot = await service.disconnect(gameId, 'alice');
      expect(snapshot?.game.status).toBe(StoryStatus.PLAYING);
      expect(scheduled('abandon-idle')).toHaveLength(1);

      clock.now += IDLE_ABANDON_DELAY_MS;
      await service.abandonIdleGame(gameId, 1);
      expect((await gameOf(gameId)).status).toBe(StoryStatus.ABANDONED);
    });

    it('survives a redeploy: everyone drops and comes back within the margin', async () => {
      const gameId = await playingWith('alice', 'bob', 'carol');
      for (const id of ['alice', 'bob', 'carol']) await service.disconnect(gameId, id);
      clock.now += 5_000;
      for (const id of ['carol', 'alice', 'bob']) await service.resume(id);

      clock.now = T0 + IDLE_ABANDON_DELAY_MS;
      await service.abandonIdleGame(gameId, 1);
      const game = await gameOf(gameId);
      expect(game.status).toBe(StoryStatus.PLAYING);
      expect(game.abandonAt).toBeNull();
      expect(game.hostId).toBe('carol'); // el primero que volvió
    });

    it('abandons a PLAYING game right away when every player left', async () => {
      const gameId = await playingWith('alice', 'bob');
      await service.leaveGame(gameId, 'bob');
      const { game } = await service.leaveGame(gameId, 'alice');
      expect(game.status).toBe(StoryStatus.ABANDONED);
      expect(scheduled('abandon-idle')).toHaveLength(0);
    });

    it.each([StoryStatus.PROCESSING, StoryStatus.REVIEW])(
      'never abandons a game in %s',
      async (status) => {
        const gameId = await playingWith('alice', 'bob');
        await forceStatus(gameId, status);

        await service.disconnect(gameId, 'alice');
        await service.leaveGame(gameId, 'bob');
        const game = await gameOf(gameId);
        expect(game.status).toBe(status);
        expect(game.abandonAt).toBeNull();
        expect(scheduled('abandon-idle')).toHaveLength(0);
      },
    );

    it('drops a pending abandon job once the game reached PROCESSING', async () => {
      const gameId = await playingWith('alice', 'bob');
      await service.disconnect(gameId, 'bob');
      await service.disconnect(gameId, 'alice'); // abandon-idle seq 1 pendiente
      await forceStatus(gameId, StoryStatus.PROCESSING);

      clock.now += IDLE_ABANDON_DELAY_MS;
      await service.abandonIdleGame(gameId, 1);
      expect((await gameOf(gameId)).status).toBe(StoryStatus.PROCESSING);
    });

    it('ignores the abandon job of a game that expired', async () => {
      await expect(service.abandonIdleGame('expired', 1)).resolves.toBeUndefined();
    });
  });

  describe('resume', () => {
    it('returns null when the user has no game', async () => {
      expect(await service.resume('alice')).toBeNull();
    });

    it('clears the reference to an abandoned game', async () => {
      const gameId = await playingWith('alice', 'bob');
      await service.disconnect(gameId, 'bob');
      await service.disconnect(gameId, 'alice');
      clock.now += IDLE_ABANDON_DELAY_MS;
      await service.abandonIdleGame(gameId, 1);
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
    expect((await gameOf(gameId)).players).toHaveLength(6);
  });
});
