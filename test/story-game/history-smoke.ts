/**
 * Prueba manual del historial contra el Postgres local (no corre con jest).
 * Guarda una historieta con dos usuarios reales de la base, la lista, la lee,
 * reacciona y la borra. Uso: npx ts-node -r tsconfig-paths/register test/story-game/history-smoke.ts
 */
import 'reflect-metadata';
import { randomUUID } from 'crypto';
import { AppDataSource } from '@/db/data-source';
import { Story, User } from '@/db/entities';
import { StoryHistoryService } from '@/modules/story-history/story-history.service';
import { StoryUrlSigner } from '@/modules/story-game/story-url-signer.service';
import { StorySnapshot } from '@/modules/story-game/domain/story-game.types';

const signer = {
  avatarsFor: (players: { userId: string; avatarKey?: string | null }[]) =>
    Promise.resolve(
      Object.fromEntries(
        players.filter((p) => p.avatarKey).map((p) => [p.userId, `signed:${p.avatarKey}`]),
      ),
    ),
  mediaFor: (panels: { order: number; media?: { audioKey: string | null } }[]) =>
    Promise.resolve(
      Object.fromEntries(
        panels
          .filter((p) => p.media?.audioKey)
          .map((p) => [p.order, { audioUrl: `signed:${p.media!.audioKey}`, imageUrl: null }]),
      ),
    ),
  signMedia: (media: { imageKey: string | null }) =>
    Promise.resolve({ audioUrl: null, imageUrl: media.imageKey && `signed:${media.imageKey}` }),
} as unknown as StoryUrlSigner;

function check(condition: unknown, message: string) {
  if (!condition) throw new Error(`FAILED: ${message}`);
  console.log(`ok - ${message}`);
}

async function main() {
  await AppDataSource.initialize();
  const users = await AppDataSource.getRepository(User).find({ take: 2 });
  if (users.length < 2) throw new Error('need 2 users in the local DB');
  const [alice, bob] = users;
  const storyId = randomUUID();
  const gameId = `smoke_${Date.now()}`;

  const panel = (order: number, authorId: string) => ({
    order,
    authorId,
    status: 'closed',
    attempts: 1,
    drafts: [],
    submissions: 1,
    reviewing: null,
    closeWhenReviewed: false,
    originalText: `Panel ${order} text written by the player.`,
    finalText: `Panel ${order} text written by the player.`,
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
    media: {
      status: 'ready',
      audioKey: `story/${storyId}/panel-${order}.mp3`,
      imageKey: order === 0 ? `story/${storyId}/panel-0.png` : null,
      speechMarks: [{ time: 0, start: 0, end: 5, value: 'Panel' }],
    },
  });
  const snapshot = {
    game: {
      gameId,
      status: 'FINISHED',
      hostId: alice.id,
      config: {
        panelsCount: 4,
        turnDurationSec: 90,
        level: 'A2',
        language: 'en-US',
        shareDrafts: true,
      },
      players: [alice, bob].map((user) => ({
        userId: user.id,
        username: user.username,
        connected: true,
        left: false,
        joinedAt: 1,
        totalScore: 150,
        panelsWritten: 1,
      })),
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
    panels: { 0: panel(0, alice.id), 1: panel(1, bob.id) },
  } as unknown as StorySnapshot;

  const service = new StoryHistoryService(AppDataSource.getRepository(Story), signer);
  try {
    check(await service.save(snapshot), 'saves the story');
    check(!(await service.save(snapshot)), 'a second save is a no-op');

    const page = await service.list(alice.id, 1, 5);
    const item = page.items.find((i) => i.storyId === storyId);
    check(item, 'the story is in the history of a participant');
    check(
      item!.coverImageUrl === `signed:story/${storyId}/panel-0.png`,
      'the cover is the first image',
    );
    check(item!.players.length === 2, 'the list brings every player');

    await service.onPanelReaction({ gameId, order: 1, userId: bob.id, emoji: '🔥' });
    let manifest = await service.get(storyId, alice.id);
    check(manifest.panels[1].reactions[bob.id] === '🔥', 'a reaction after FINISHED is stored');
    check(manifest.panels[0].audioUrl === `signed:story/${storyId}/panel-0.mp3`, 'media is signed');
    check(manifest.panels[0].speechMarks?.length === 1, 'speech marks are kept');

    await service.onPanelReaction({ gameId, order: 1, userId: bob.id, emoji: null });
    manifest = await service.get(storyId, alice.id);
    check(!(bob.id in manifest.panels[1].reactions), 'removing the reaction works');

    await service.get(storyId, randomUUID()).then(
      () => check(false, 'a non participant gets 404'),
      () => check(true, 'a non participant gets 404'),
    );
  } finally {
    await AppDataSource.getRepository(Story).delete({ id: storyId });
    console.log('cleaned up');
    await AppDataSource.destroy();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
