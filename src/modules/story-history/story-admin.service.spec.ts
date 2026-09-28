import { ConflictException, NotFoundException } from '@nestjs/common';
import { Repository } from 'typeorm';
import { Story } from '@/db/entities';
import { StoryRemovalReason, StoryVisibility } from '@/db/enum/story.enum';
import { StoryGameService } from '@/modules/story-game/story-game.service';
import { StoryHistoryService } from './story-history.service';
import { StoryAdminService } from './story-admin.service';

const story = (overrides: Partial<Story> = {}) =>
  ({
    id: 'story-1',
    gameId: 'g1',
    title: 'The Shiny Key',
    level: 'A2',
    finishedAt: new Date('2026-09-27T12:00:00Z'),
    visibility: StoryVisibility.PUBLISHED,
    removedAt: null,
    removedBy: null,
    removedById: null,
    removalReason: null,
    removalNote: null,
    panels: [{ order: 0, finalText: 'Max found a shiny key.', imageKey: null }],
    participants: [
      {
        userId: 'alice',
        username: 'Alice',
        position: 1,
        panelsWritten: 1,
        totalScore: 150,
        left: false,
        user: { username: 'alice_now', email: 'alice@example.com' },
      },
    ],
    ...overrides,
  }) as unknown as Story;

describe('StoryAdminService', () => {
  let queryBuilder: Record<string, jest.Mock>;
  let updateBuilder: Record<string, jest.Mock>;
  let history: Record<string, jest.Mock>;
  let game: { discardFinishedStory: jest.Mock };
  let service: StoryAdminService;

  beforeEach(() => {
    queryBuilder = {};
    for (const method of ['leftJoinAndSelect', 'andWhere', 'orderBy', 'skip', 'take']) {
      queryBuilder[method] = jest.fn(() => queryBuilder);
    }
    queryBuilder.getOne = jest.fn().mockResolvedValue(story());
    queryBuilder.getManyAndCount = jest.fn().mockResolvedValue([[story()], 1]);

    updateBuilder = {};
    for (const method of ['update', 'set', 'where']) {
      updateBuilder[method] = jest.fn(() => updateBuilder);
    }
    updateBuilder.execute = jest.fn().mockResolvedValue({ affected: 1 });

    history = {
      detailsQuery: jest.fn(() => queryBuilder),
      avatarsOf: jest.fn().mockResolvedValue({ alice: 'https://signed/alice.png' }),
      coverUrlOf: jest.fn().mockResolvedValue(null),
      manifestOf: jest.fn().mockResolvedValue({ storyId: 'story-1', panels: [] }),
    };
    game = { discardFinishedStory: jest.fn().mockResolvedValue(undefined) };
    service = new StoryAdminService(
      { createQueryBuilder: jest.fn(() => updateBuilder) } as unknown as Repository<Story>,
      history as unknown as StoryHistoryService,
      game as unknown as StoryGameService,
    );
  });

  describe('list', () => {
    it('lists every story, newest first, with the players and how to reach them', async () => {
      const page = await service.list({ page: 2, limit: 10 });

      expect(queryBuilder.leftJoinAndSelect).toHaveBeenCalledWith('story.removedBy', 'removedBy');
      expect(queryBuilder.andWhere).not.toHaveBeenCalled();
      expect(queryBuilder.skip).toHaveBeenCalledWith(10);
      expect(page).toMatchObject({ page: 2, limit: 10, total: 1 });
      expect(page.items[0]).toMatchObject({
        storyId: 'story-1',
        visibility: 'PUBLISHED',
        removal: null,
        participants: [
          {
            userId: 'alice',
            username: 'Alice',
            currentUsername: 'alice_now',
            email: 'alice@example.com',
            avatarUrl: 'https://signed/alice.png',
          },
        ],
      });
    });

    it('filters by visibility and searches with the wildcards of the admin text escaped', async () => {
      await service.list({
        page: 1,
        limit: 20,
        visibility: StoryVisibility.REMOVED,
        search: '50%_off',
      });

      expect(queryBuilder.andWhere).toHaveBeenCalledWith('story.visibility = :visibility', {
        visibility: 'REMOVED',
      });
      const [, params] = queryBuilder.andWhere.mock.calls[1] as [string, { search: string }];
      expect(params.search).toBe('%50\\%\\_off%');
    });
  });

  it('shows the detail of any story with its full manifest', async () => {
    const detail = await service.get('story-1');
    expect(detail).toMatchObject({ storyId: 'story-1', manifest: { storyId: 'story-1' } });
    expect(history.manifestOf).toHaveBeenCalled();

    queryBuilder.getOne.mockResolvedValue(null);
    await expect(service.get('missing')).rejects.toBeInstanceOf(NotFoundException);
  });

  describe('remove', () => {
    it('removes a published story, records who, why and when, and drops its live review', async () => {
      await service.remove('story-1', 'admin-1', StoryRemovalReason.OTHER, 'Real phone number');

      expect(updateBuilder.set).toHaveBeenCalledWith({
        visibility: 'REMOVED',
        removedAt: expect.any(Function) as unknown,
        removedById: 'admin-1',
        removalReason: 'OTHER',
        removalNote: 'Real phone number',
      });
      expect(updateBuilder.where).toHaveBeenCalledWith(
        'id = :storyId AND visibility = :published',
        { storyId: 'story-1', published: 'PUBLISHED' },
      );
      expect(game.discardFinishedStory).toHaveBeenCalledWith('g1');
    });

    it('returns the story with the removal info', async () => {
      queryBuilder.getOne.mockResolvedValueOnce(story()).mockResolvedValueOnce(
        story({
          visibility: StoryVisibility.REMOVED,
          removedAt: new Date('2026-09-28T10:00:00Z'),
          removedBy: { id: 'admin-1', username: 'Admin' } as never,
          removalReason: StoryRemovalReason.SPAM,
        }),
      );

      const detail = await service.remove('story-1', 'admin-1', StoryRemovalReason.SPAM);
      expect(detail.removal).toEqual({
        removedAt: '2026-09-28T10:00:00.000Z',
        removedBy: { userId: 'admin-1', username: 'Admin' },
        reason: 'SPAM',
        note: null,
      });
    });

    it('answers 409 when the story was already removed, also if another admin won the race', async () => {
      queryBuilder.getOne.mockResolvedValue(story({ visibility: StoryVisibility.REMOVED }));
      await expect(
        service.remove('story-1', 'admin-1', StoryRemovalReason.SPAM),
      ).rejects.toBeInstanceOf(ConflictException);

      queryBuilder.getOne.mockResolvedValue(story());
      updateBuilder.execute.mockResolvedValue({ affected: 0 });
      await expect(
        service.remove('story-1', 'admin-1', StoryRemovalReason.SPAM),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(game.discardFinishedStory).not.toHaveBeenCalled();
    });

    it('answers 404 for an unknown story', async () => {
      queryBuilder.getOne.mockResolvedValue(null);
      await expect(
        service.remove('missing', 'admin-1', StoryRemovalReason.SPAM),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('still removes the story if Redis fails', async () => {
      game.discardFinishedStory.mockRejectedValue(new Error('redis down'));
      await expect(
        service.remove('story-1', 'admin-1', StoryRemovalReason.SPAM),
      ).resolves.toMatchObject({ storyId: 'story-1' });
    });
  });
});
