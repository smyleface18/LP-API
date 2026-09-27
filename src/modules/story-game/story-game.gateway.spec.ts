import { Server } from 'socket.io';
import { WsAuthService } from '@/common/src/ws-auth/ws-auth.service';
import { StoryGameGateway } from './story-game.gateway';
import { StoryGameService } from './story-game.service';
import { StoryError } from './domain/story-game.errors';
import { StorySnapshot, StoryStatus } from './domain/story-game.types';
import { STORY_DEFAULT_CONFIG } from './story-game.config';
import { StorySocket } from './types';

const snapshot = (gameId = 'g1'): StorySnapshot => ({
  game: {
    gameId,
    status: StoryStatus.LOBBY,
    hostId: 'alice',
    config: { ...STORY_DEFAULT_CONFIG },
    players: [{ userId: 'alice', username: 'Alice', connected: true, left: false, joinedAt: 1 }],
    currentPanel: null,
    turnEndsAt: null,
    abandonAt: null,
    abandonSeq: 0,
    createdAt: 1,
  },
  characters: {},
});

/** Server de Socket.IO falso: registra `to(room).emit` e `in(room).socketsJoin/Leave`. */
function fakeServer() {
  const emitted: [string, string, unknown][] = [];
  const joined: [string, string][] = [];
  const left: [string, string][] = [];
  const server = {
    to: (room: string) => ({
      emit: (event: string, payload: unknown) => emitted.push([room, event, payload]),
    }),
    in: (room: string) => ({
      socketsJoin: (target: string) => joined.push([room, target]),
      socketsLeave: (target: string) => left.push([room, target]),
    }),
  };
  return { server: server as unknown as Server, emitted, joined, left };
}

describe('StoryGameGateway', () => {
  let service: jest.Mocked<
    Pick<
      StoryGameService,
      | 'createGame'
      | 'kickPlayer'
      | 'leaveGame'
      | 'startStory'
      | 'disconnect'
      | 'resume'
      | 'getActiveGameId'
    >
  >;
  let auth: { authenticateSocket: jest.Mock };
  let gateway: StoryGameGateway;
  let io: ReturnType<typeof fakeServer>;
  const client = (userId = 'alice', join = jest.fn()) =>
    ({ data: { userId, role: [] }, join }) as unknown as StorySocket;

  beforeEach(() => {
    service = {
      createGame: jest.fn().mockResolvedValue(snapshot()),
      kickPlayer: jest.fn().mockResolvedValue(snapshot()),
      leaveGame: jest.fn().mockResolvedValue(snapshot()),
      startStory: jest.fn().mockResolvedValue(snapshot()),
      disconnect: jest.fn().mockResolvedValue(null),
      resume: jest.fn().mockResolvedValue(null),
      getActiveGameId: jest.fn().mockResolvedValue('g1'),
    };
    auth = { authenticateSocket: jest.fn().mockResolvedValue({ username: 'alice' }) };
    gateway = new StoryGameGateway(
      service as unknown as StoryGameService,
      auth as unknown as WsAuthService,
    );
    io = fakeServer();
    gateway.server = io.server;
  });

  it('puts every socket in its personal room on connect', async () => {
    const join = jest.fn();
    const socket = client('alice', join);
    await gateway.handleConnection(socket);
    expect(auth.authenticateSocket).toHaveBeenCalledWith(socket, 'storyError');
    expect(join).toHaveBeenCalledWith('user:alice');
  });

  it('does nothing else when authentication fails', async () => {
    auth.authenticateSocket.mockResolvedValue(null);
    const join = jest.fn();
    await gateway.handleConnection(client('alice', join));
    expect(join).not.toHaveBeenCalled();
    expect(service.resume).not.toHaveBeenCalled();
  });

  it('joins all the sockets of the creator to the game room', async () => {
    await gateway.handleCreate(client());
    expect(io.joined).toEqual([['user:alice', 'g1']]);
    expect(io.emitted.map(([room, event]) => [room, event])).toEqual([['g1', 'lobbyUpdated']]);
  });

  it('resolves the current game from Redis, not from the socket', async () => {
    service.getActiveGameId.mockResolvedValue('g7');
    await gateway.handleStartStory(client());
    expect(service.startStory).toHaveBeenCalledWith('g7', 'alice');
  });

  it('rejects game events when the user has no active game', async () => {
    service.getActiveGameId.mockResolvedValue(null);
    await expect(gateway.handleStartStory(client())).rejects.toMatchObject({
      code: 'NOT_IN_GAME',
    });
    await expect(gateway.handleStartStory(client())).rejects.toBeInstanceOf(StoryError);
  });

  it('tells the kicked user KICKED and removes all their sockets from the room', async () => {
    await gateway.handleKick({ userId: 'bob' }, client('alice'));

    expect(service.kickPlayer).toHaveBeenCalledWith('g1', 'alice', 'bob');
    expect(io.emitted).toContainEqual([
      'user:bob',
      'storyError',
      {
        ok: false,
        status: 403,
        message: 'The host removed you from the game',
        code: 'KICKED',
      },
    ]);
    expect(io.left).toEqual([['user:bob', 'g1']]);
    expect(io.emitted.at(-1)?.slice(0, 2)).toEqual(['g1', 'lobbyUpdated']);
  });

  it('removes every socket of a leaving user from the room', async () => {
    await gateway.handleLeave(client('alice'));
    expect(io.left).toEqual([['user:alice', 'g1']]);
  });

  it('marks the user disconnected in their active game and broadcasts', async () => {
    service.disconnect.mockResolvedValue(snapshot());
    await gateway.handleDisconnect(client('alice'));
    expect(service.disconnect).toHaveBeenCalledWith('g1', 'alice');
    expect(io.emitted.map(([room, event]) => [room, event])).toEqual([['g1', 'lobbyUpdated']]);
  });

  it('ignores the disconnect of a user without an active game', async () => {
    service.getActiveGameId.mockResolvedValue(null);
    await gateway.handleDisconnect(client('alice'));
    expect(service.disconnect).not.toHaveBeenCalled();
  });
});
