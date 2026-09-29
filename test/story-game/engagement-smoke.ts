/**
 * Prueba manual de reacciones y likes sobre historietas guardadas, contra el
 * Postgres local (no corre con jest). Todo pasa dentro de una transacción que
 * al final se deshace: la base queda igual. Uso:
 *   npx ts-node -r tsconfig-paths/register test/story-game/engagement-smoke.ts
 */
import 'reflect-metadata';
import { AppDataSource } from '@/db/data-source';
import { Story, User } from '@/db/entities';
import { StoryVisibility } from '@/db/enum/story.enum';
import { StoryHistoryService } from '@/modules/story-history/story-history.service';
import { StoryUrlSigner } from '@/modules/story-game/story-url-signer.service';

const signer = {
  avatarsFor: () => Promise.resolve({}),
  mediaFor: () => Promise.resolve({}),
  signMedia: () => Promise.resolve({ audioUrl: null, imageUrl: null }),
} as unknown as StoryUrlSigner;

async function main() {
  await AppDataSource.initialize();
  const runner = AppDataSource.createQueryRunner();
  await runner.startTransaction();
  try {
    const stories = runner.manager.getRepository(Story);
    const history = new StoryHistoryService(stories, signer);
    const target = await stories.findOne({ where: { visibility: StoryVisibility.PUBLISHED } });
    const user = await runner.manager.getRepository(User).findOne({ where: {} });
    if (!target || !user) throw new Error('need a published story and a user');

    console.log('react 🔥:', await history.react(target.id, 0, user.id, '🔥'));
    console.log('react null:', await history.react(target.id, 0, user.id, null));
    console.log(
      'react on a missing panel:',
      await history.react(target.id, 999, user.id, '👏').then(
        () => 'saved (BAD)',
        () => '404',
      ),
    );
    console.log('like:', await history.like(target.id, user.id));
    console.log('like again:', await history.like(target.id, user.id));
    const page = await history.listCatalog(user.id, 1, 5);
    console.log(
      'catalog likes:',
      page.items.map((item) => [item.storyId.slice(0, 8), item.likes]),
    );
    const manifest = await history.getFromCatalog(target.id, user.id);
    console.log('manifest likes:', manifest.likes, manifest.reactionOptions);
    console.log('unlike:', await history.unlike(target.id, user.id));
  } finally {
    await runner.rollbackTransaction();
    await runner.release();
    await AppDataSource.destroy();
  }
}

void main();
