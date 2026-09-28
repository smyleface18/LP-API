import { StorageService } from '@/common/src/storage/storage.service';
import { StoryUrlSigner } from './story-url-signer.service';
import { SIGNED_URL_MIN_REMAINING_MS, SIGNED_URL_TTL_SEC } from './story-game.config';

describe('StoryUrlSigner', () => {
  const T0 = 1_800_000_000_000;
  let now: number;
  let storage: { getReadUrl: jest.Mock };
  let signer: StoryUrlSigner;

  beforeEach(() => {
    now = T0;
    jest.spyOn(Date, 'now').mockImplementation(() => now);
    let signed = 0;
    storage = {
      getReadUrl: jest.fn((key: string) => Promise.resolve(`https://s3/${key}?v=${++signed}`)),
    };
    signer = new StoryUrlSigner(storage as unknown as StorageService);
  });

  afterEach(() => jest.restoreAllMocks());

  it('signs the key of each player with an avatar and skips the rest', async () => {
    const urls = await signer.avatarsFor([
      { userId: 'alice', avatarKey: 'avatar/a.png' },
      { userId: 'bob', avatarKey: null },
      { userId: 'carol' },
    ]);

    expect(urls).toEqual({ alice: 'https://s3/avatar/a.png?v=1' });
    expect(storage.getReadUrl).toHaveBeenCalledWith('avatar/a.png', SIGNED_URL_TTL_SEC);
  });

  it('reuses a URL while enough time is left, so the client keeps its cached image', async () => {
    const players = [{ userId: 'alice', avatarKey: 'avatar/a.png' }];
    const first = await signer.avatarsFor(players);

    now = T0 + SIGNED_URL_TTL_SEC * 1000 - SIGNED_URL_MIN_REMAINING_MS;
    expect(await signer.avatarsFor(players)).toEqual(first);

    now += 1;
    expect(await signer.avatarsFor(players)).toEqual({ alice: 'https://s3/avatar/a.png?v=2' });
    expect(storage.getReadUrl).toHaveBeenCalledTimes(2);
  });

  it('leaves out an avatar it cannot sign instead of failing', async () => {
    storage.getReadUrl.mockRejectedValueOnce(new Error('no credentials'));
    const urls = await signer.avatarsFor([
      { userId: 'alice', avatarKey: 'avatar/a.png' },
      { userId: 'bob', avatarKey: 'avatar/b.png' },
    ]);

    expect(urls).toEqual({ bob: 'https://s3/avatar/b.png?v=1' });
  });

  it('signs the audio and image of each panel that has media', async () => {
    const media = await signer.mediaFor([
      {
        order: 0,
        media: { audioKey: 'story/s1/panel-0.mp3', imageKey: 'story/s1/panel-0.png' },
      },
      { order: 1, media: { audioKey: null, imageKey: null } },
      { order: 2 },
    ]);

    expect(media).toEqual({
      0: {
        audioUrl: 'https://s3/story/s1/panel-0.mp3?v=1',
        imageUrl: 'https://s3/story/s1/panel-0.png?v=2',
      },
    });
  });
});
