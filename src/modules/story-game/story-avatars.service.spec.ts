import { StorageService } from '@/common/src/storage/storage.service';
import { StoryAvatars } from './story-avatars.service';
import { AVATAR_URL_MIN_REMAINING_MS, AVATAR_URL_TTL_SEC } from './story-game.config';

describe('StoryAvatars', () => {
  const T0 = 1_800_000_000_000;
  let now: number;
  let storage: { getReadUrl: jest.Mock };
  let avatars: StoryAvatars;

  beforeEach(() => {
    now = T0;
    jest.spyOn(Date, 'now').mockImplementation(() => now);
    let signed = 0;
    storage = {
      getReadUrl: jest.fn((key: string) => Promise.resolve(`https://s3/${key}?v=${++signed}`)),
    };
    avatars = new StoryAvatars(storage as unknown as StorageService);
  });

  afterEach(() => jest.restoreAllMocks());

  it('signs the key of each player with an avatar and skips the rest', async () => {
    const urls = await avatars.urlsFor([
      { userId: 'alice', avatarKey: 'avatar/a.png' },
      { userId: 'bob', avatarKey: null },
      { userId: 'carol' },
    ]);

    expect(urls).toEqual({ alice: 'https://s3/avatar/a.png?v=1' });
    expect(storage.getReadUrl).toHaveBeenCalledWith('avatar/a.png', AVATAR_URL_TTL_SEC);
  });

  it('reuses a URL while enough time is left, so the client keeps its cached image', async () => {
    const players = [{ userId: 'alice', avatarKey: 'avatar/a.png' }];
    const first = await avatars.urlsFor(players);

    now = T0 + AVATAR_URL_TTL_SEC * 1000 - AVATAR_URL_MIN_REMAINING_MS;
    expect(await avatars.urlsFor(players)).toEqual(first);

    now += 1;
    expect(await avatars.urlsFor(players)).toEqual({ alice: 'https://s3/avatar/a.png?v=2' });
    expect(storage.getReadUrl).toHaveBeenCalledTimes(2);
  });

  it('leaves out an avatar it cannot sign instead of failing', async () => {
    storage.getReadUrl.mockRejectedValueOnce(new Error('no credentials'));
    const urls = await avatars.urlsFor([
      { userId: 'alice', avatarKey: 'avatar/a.png' },
      { userId: 'bob', avatarKey: 'avatar/b.png' },
    ]);

    expect(urls).toEqual({ bob: 'https://s3/avatar/b.png?v=1' });
  });
});
