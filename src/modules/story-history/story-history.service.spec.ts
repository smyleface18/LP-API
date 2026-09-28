import { NotFoundException } from '@nestjs/common';
import { Repository } from 'typeorm';
import { Story, StoryPanel, StoryParticipant } from '@/db/entities';
import { StorySnapshot } from '@/modules/story-game/domain/story-game.types';
import { StoryUrlSigner } from '@/modules/story-game/story-url-signer.service';
import { StoryHistoryService } from './story-history.service';

/** Partida FINISHED mínima: una viñeta de alice. */
const snapshot = (storyId: string | null = 'story-1'): StorySnapshot =>
  ({
    game: {
      gameId: 'g1',
      status: 'FINISHED',
      hostId: 'alice',
      config: {
        panelsCount: 4,
        turnDurationSec: 90,
        level: 'A2',
        language: 'en-US',
        shareDrafts: true,
      },
      players: [
        {
          userId: 'alice',
          username: 'Alice',
          connected: true,
          left: false,
          joinedAt: 1,
          totalScore: 150,
          panelsWritten: 1,
        },
      ],
      currentPanel: null,
      turnEndsAt: null,
      turnCloseAt: null,
      abandonAt: null,
      abandonSeq: 0,
      createdAt: 1,
      storyId,
      mediaDeadlineAt: null,
    },
    characters: {},
    panels: {
      0: {
        order: 0,
        authorId: 'alice',
        status: 'closed',
        attempts: 1,
        drafts: [],
        submissions: 1,
        reviewing: null,
        closeWhenReviewed: false,
        originalText: 'Max walked home.',
        finalText: 'Max walked home.',
        scene: 'A street',
        characterIds: [],
        score: {
          accuracy: 100,
          firstTryBonus: 50,
          selfCorrectionBonus: 0,
          timeoutPenalty: false,
          total: 150,
        },
        confirmedBy: 'player',
        reactions: {},
        media: { status: 'ready', audioKey: 'a.mp3', imageKey: null, speechMarks: [] },
      },
    },
  }) as unknown as StorySnapshot;

describe('StoryHistoryService', () => {
  let manager: { exists: jest.Mock; insert: jest.Mock; transaction: jest.Mock; query: jest.Mock };
  let queryBuilder: Record<string, jest.Mock>;
  let urls: { avatarsFor: jest.Mock; mediaFor: jest.Mock; signMedia: jest.Mock };
  let service: StoryHistoryService;

  beforeEach(() => {
    manager = {
      exists: jest.fn().mockResolvedValue(false),
      insert: jest.fn().mockResolvedValue(undefined),
      transaction: jest.fn(),
      query: jest.fn().mockResolvedValue(undefined),
    };
    manager.transaction.mockImplementation((fn: (m: typeof manager) => unknown) => fn(manager));
    queryBuilder = {};
    for (const method of [
      'leftJoinAndSelect',
      'innerJoin',
      'orderBy',
      'skip',
      'take',
      'where',
      'andWhere',
    ]) {
      queryBuilder[method] = jest.fn(() => queryBuilder);
    }
    queryBuilder.getOne = jest.fn();
    queryBuilder.getManyAndCount = jest.fn();
    const stories = { manager, createQueryBuilder: jest.fn(() => queryBuilder) };
    urls = {
      avatarsFor: jest.fn().mockResolvedValue({}),
      mediaFor: jest
        .fn()
        .mockResolvedValue({ 0: { audioUrl: 'https://signed/a.mp3', imageUrl: null } }),
      signMedia: jest
        .fn()
        .mockResolvedValue({ audioUrl: null, imageUrl: 'https://signed/cover.png' }),
    };
    service = new StoryHistoryService(
      stories as unknown as Repository<Story>,
      urls as unknown as StoryUrlSigner,
    );
  });

  describe('save', () => {
    it('stores the story, its panels and its participants in one transaction', async () => {
      await expect(service.save(snapshot())).resolves.toBe(true);

      expect(manager.transaction).toHaveBeenCalledTimes(1);
      expect(manager.insert).toHaveBeenCalledWith(
        Story,
        expect.objectContaining({ id: 'story-1', gameId: 'g1' }),
      );
      expect(manager.insert).toHaveBeenCalledWith(StoryPanel, [
        expect.objectContaining({ storyId: 'story-1', order: 0, audioKey: 'a.mp3' }),
      ]);
      expect(manager.insert).toHaveBeenCalledWith(StoryParticipant, [
        expect.objectContaining({ storyId: 'story-1', userId: 'alice', position: 1 }),
      ]);
    });

    it('does nothing if the story was already saved, or has no story id', async () => {
      manager.exists.mockResolvedValue(true);
      await expect(service.save(snapshot())).resolves.toBe(false);
      await expect(service.save(snapshot(null))).resolves.toBe(false);
      expect(manager.insert).not.toHaveBeenCalled();
    });

    it('never throws out of the finished listener', async () => {
      manager.transaction.mockRejectedValue(new Error('db down'));
      await expect(service.onStoryFinished({ snapshot: snapshot() })).resolves.toBeUndefined();
    });
  });

  it('updates a stored reaction in place, and removes it with null', async () => {
    await service.onPanelReaction({ gameId: 'g1', order: 2, userId: 'bob', emoji: '🔥' });
    await service.onPanelReaction({ gameId: 'g1', order: 2, userId: 'bob', emoji: null });

    const calls = manager.query.mock.calls as [string, unknown[]][];
    expect(calls.map(([, params]) => params)).toEqual([
      ['g1', 'bob', '🔥', 2],
      ['g1', 'bob', null, 2],
    ]);
  });

  const storedStory = () =>
    ({
      id: 'story-1',
      gameId: 'g1',
      level: 'A2',
      language: 'en-US',
      panelsCount: 4,
      characters: [],
      finishedAt: new Date('2026-09-27T12:00:00Z'),
      panels: [
        {
          order: 0,
          authorId: 'alice',
          authorName: 'Alice',
          originalText: 'Max walked home.',
          finalText: 'Max walked home.',
          scene: 'A street',
          characterIds: [],
          corrections: [],
          score: { total: 150 },
          reactions: {},
          mediaStatus: 'ready',
          audioKey: 'a.mp3',
          imageKey: 'cover.png',
          speechMarks: [],
        },
      ],
      participants: [
        {
          userId: 'alice',
          username: 'Alice',
          position: 1,
          panelsWritten: 1,
          totalScore: 150,
          averageScore: 150,
          user: { avatar: { key: 'avatar/alice.png' } },
        },
      ],
    }) as unknown as Story;

  describe('get', () => {
    it('serves the manifest to a participant, with signed media', async () => {
      queryBuilder.getOne.mockResolvedValue(storedStory());
      const manifest = await service.get('story-1', 'alice');

      expect(manifest.panels[0].audioUrl).toBe('https://signed/a.mp3');
      expect(urls.avatarsFor).toHaveBeenCalledWith([
        { userId: 'alice', avatarKey: 'avatar/alice.png' },
      ]);
    });

    it('answers 404 to someone who did not play it, and for unknown stories', async () => {
      queryBuilder.getOne.mockResolvedValue(storedStory());
      await expect(service.get('story-1', 'mallory')).rejects.toBeInstanceOf(NotFoundException);
      queryBuilder.getOne.mockResolvedValue(null);
      await expect(service.get('nope', 'alice')).rejects.toBeInstanceOf(NotFoundException);
    });

    it('only serves published stories (a removed one is a 404)', async () => {
      queryBuilder.getOne.mockResolvedValue(storedStory());
      await service.get('story-1', 'alice');
      expect(queryBuilder.andWhere).toHaveBeenCalledWith('story.visibility = :published', {
        published: 'PUBLISHED',
      });
    });
  });

  describe('catalog', () => {
    it('lists the published stories of every player, newest first, filtered by level and text', async () => {
      queryBuilder.getManyAndCount.mockResolvedValue([[storedStory()], 1]);
      const page = await service.listCatalog('mallory', 1, 20, {
        levels: ['A1', 'A2'] as never,
        search: 'robot',
      });

      expect(queryBuilder.innerJoin).not.toHaveBeenCalled();
      expect(queryBuilder.where).toHaveBeenCalledWith('story.visibility = :published', {
        published: 'PUBLISHED',
      });
      expect(queryBuilder.andWhere).toHaveBeenCalledWith('story.level IN (:...levels)', {
        levels: ['A1', 'A2'],
      });
      // Búsqueda en título, jugadores y viñetas (sin el código de la partida).
      const [searchSql, params] = queryBuilder.andWhere.mock.calls[1] as [string, object];
      expect(searchSql).not.toContain('gameId');
      expect(searchSql).toContain('"finalText" ILIKE :search');
      expect(params).toEqual({ search: '%robot%' });
      expect(queryBuilder.orderBy).toHaveBeenCalledWith('story.finishedAt', 'DESC');
      // Quien pide no jugó: sin puesto ni puntaje propio.
      expect(page.items[0]).toMatchObject({ storyId: 'story-1', myPosition: null, myScore: 0 });
    });

    it('does not filter by level when none is given', async () => {
      queryBuilder.getManyAndCount.mockResolvedValue([[], 0]);
      await service.listCatalog('mallory', 1, 20);
      expect(queryBuilder.andWhere).not.toHaveBeenCalled();
    });

    it('serves a published story to anyone, and 404 otherwise', async () => {
      queryBuilder.getOne.mockResolvedValue(storedStory());
      const manifest = await service.getFromCatalog('story-1');
      expect(manifest.panels[0].audioUrl).toBe('https://signed/a.mp3');

      queryBuilder.getOne.mockResolvedValue(null);
      await expect(service.getFromCatalog('story-1')).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  it('lists the stories of the user, newest first, paginated, with a cover', async () => {
    queryBuilder.getManyAndCount.mockResolvedValue([[storedStory()], 21]);
    const page = await service.list('alice', 2, 20);

    expect(queryBuilder.innerJoin).toHaveBeenCalledWith(
      'story.participants',
      'me',
      'me.userId = :userId',
      { userId: 'alice' },
    );
    expect(queryBuilder.where).toHaveBeenCalledWith('story.visibility = :published', {
      published: 'PUBLISHED',
    });
    expect(queryBuilder.orderBy).toHaveBeenCalledWith('story.finishedAt', 'DESC');
    expect(queryBuilder.skip).toHaveBeenCalledWith(20);
    expect(page).toMatchObject({ page: 2, limit: 20, total: 21 });
    expect(page.items[0]).toMatchObject({
      storyId: 'story-1',
      coverImageUrl: 'https://signed/cover.png',
      myPosition: 1,
    });
  });
});
