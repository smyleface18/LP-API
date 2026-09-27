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
import { StoryStatus } from './domain/story-game.types';
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
        except: () => ({ emit: () => undefined }),
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

  it('the last confirmed panel reaches storyReviewReady and FINISHED through @OnEvent', async () => {
    await service.createGame('alice');
    await service.joinGame('g1', 'bob');
    await service.updateConfig('g1', 'alice', { panelsCount: 4 });
    await service.startStory('g1', 'alice');
    for (const [order, author] of ['alice', 'bob', 'alice', 'bob'].entries()) {
      await service.submitPanelDraft('g1', author, order, {
        text: 'The little robot walked slowly into the dark forest tonight.',
        scene: 'Forest',
        characterIds: [],
        newCharacters: [],
      });
      await service.confirmPanel('g1', author, order);
    }

    // El listener de processingStarted es asíncrono: esperar a que termine.
    for (
      let i = 0;
      i < 50 && (await service.getSnapshot('g1')).game.status !== StoryStatus.FINISHED;
      i++
    ) {
      await new Promise(setImmediate);
    }

    expect((await service.getSnapshot('g1')).game.status).toBe(StoryStatus.FINISHED);
    const statuses = emitted
      .filter(([, event]) => event === 'lobbyUpdated')
      .map(([, , lobby]) => (lobby as { status: StoryStatus }).status);
    expect(statuses.slice(-3)).toEqual([
      StoryStatus.PROCESSING,
      StoryStatus.REVIEW,
      StoryStatus.FINISHED,
    ]);
    const ready = emitted.filter(([, event]) => event === 'storyReviewReady');
    expect(ready).toHaveLength(1);
    expect(ready[0][0]).toBe('g1');
    expect(ready[0][2]).toMatchObject({ storyId: 'g1' });
    expect((ready[0][2] as { panels: unknown[] }).panels).toHaveLength(4);
  });
});
