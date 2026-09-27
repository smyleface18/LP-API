import { Test, TestingModule } from '@nestjs/testing';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Job } from 'bullmq';
import { Server } from 'socket.io';
import { User } from '@/db/entities';
import { UniqueNamesAdapter } from '@/common/src/unique-names/unique-names.adapter';
import { WsAuthService } from '@/common/src/ws-auth/ws-auth.service';
import {
  LanguageReviewer,
  NoErrorsLanguageReviewer,
} from '@/modules/language-review/language-reviewer';
import { StoryGameGateway } from './story-game.gateway';
import { StoryGameService } from './story-game.service';
import { StoryStateRepository } from './story-state.repository';
import { StoryTimeoutProcessor } from './queue/story-timeout.processor';
import { StoryJob } from './queue/type';
import { InMemoryStoryStore } from '../../../test/story-game/story-harness';

/**
 * Camino completo de un cambio disparado por un timer, sin mocks en el medio:
 *
 *   BullMQ (cualquier instancia) → StoryTimeoutProcessor → StoryGameService
 *   → EventEmitter2 (local) → @OnEvent del gateway → server.to(gameId).emit
 *
 * `server.to(room).emit` es el mismo que usa la trivia (GameGateway con
 * 'game.next-question'): con el RedisIoAdapter de main.ts, Socket.IO publica
 * el mensaje en Redis y cada instancia lo entrega a sus sockets de esa sala.
 * Por eso no importa en qué instancia corra la tarea ni dónde esté cada jugador.
 */
describe('Timer-driven events reach the room', () => {
  const T0 = 1_800_000_000_000;
  let moduleRef: TestingModule;
  let service: StoryGameService;
  let processor: StoryTimeoutProcessor;
  let emitted: [string, string, unknown][];

  beforeEach(async () => {
    jest.spyOn(Date, 'now').mockReturnValue(T0);
    moduleRef = await Test.createTestingModule({
      imports: [EventEmitterModule.forRoot()],
      providers: [
        StoryGameGateway,
        StoryGameService,
        StoryTimeoutProcessor,
        { provide: StoryStateRepository, useValue: new InMemoryStoryStore() },
        { provide: LanguageReviewer, useClass: NoErrorsLanguageReviewer },
        { provide: WsAuthService, useValue: {} },
        { provide: UniqueNamesAdapter, useValue: { NamesGenerator: () => 'g1' } },
        {
          provide: getRepositoryToken(User),
          useValue: {
            findOne: ({ where: { id } }: { where: { id: string } }) =>
              Promise.resolve({ id, username: id }),
          },
        },
      ],
    }).compile();
    // Registra los @OnEvent, como al arrancar la app.
    await moduleRef.init();

    emitted = [];
    moduleRef.get(StoryGameGateway).server = {
      to: (room: string) => ({
        emit: (event: string, payload: unknown) => emitted.push([room, event, payload]),
      }),
    } as unknown as Server;

    service = moduleRef.get(StoryGameService);
    processor = moduleRef.get(StoryTimeoutProcessor);
  });

  afterEach(async () => {
    await moduleRef.close();
    jest.restoreAllMocks();
  });

  it('close-turn from the queue emits panelConfirmed and the next turnStarted to the room', async () => {
    await service.createGame('alice');
    await service.joinGame('g1', 'bob');
    await service.startStory('g1', 'alice');
    emitted = [];

    const dueAt = T0 + 90_000;
    jest.spyOn(Date, 'now').mockReturnValue(dueAt);
    await processor.process({
      data: { gameId: 'g1', kind: 'close-turn', seq: 0, dueAt },
    } as Job<StoryJob>);

    expect(emitted.map(([room, event]) => [room, event])).toEqual([
      ['g1', 'panelConfirmed'],
      ['g1', 'turnStarted'],
    ]);
    expect(emitted[1][2]).toMatchObject({ panelOrder: 1, authorId: 'bob' });
  });
});
