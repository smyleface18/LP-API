/**
 * Prueba manual de quitar y restaurar una historieta contra el Postgres local
 * (no corre con jest). Todo pasa dentro de una transacción que al final se
 * deshace: la base queda igual. Uso:
 *   npx ts-node -r tsconfig-paths/register test/story-game/moderation-smoke.ts
 */
import 'reflect-metadata';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { AppDataSource } from '@/db/data-source';
import { Story, StoryModerationLog, User } from '@/db/entities';
import { StoryRemovalReason, StoryVisibility } from '@/db/enum/story.enum';
import { StoryHistoryService } from '@/modules/story-history/story-history.service';
import { StoryAdminService } from '@/modules/story-history/story-admin.service';
import { StoryUrlSigner } from '@/modules/story-game/story-url-signer.service';
import { StoryGameService } from '@/modules/story-game/story-game.service';

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
    // Repositorios atados a la transacción: los `transaction()` del servicio
    // quedan anidados (savepoints) y el rollback final deshace todo.
    const stories = runner.manager.getRepository(Story);
    const history = new StoryHistoryService(stories, signer);
    const game = { discardFinishedStory: () => Promise.resolve() } as unknown as StoryGameService;
    const admin = new StoryAdminService(
      stories,
      runner.manager.getRepository(StoryModerationLog),
      history,
      game,
      new EventEmitter2(),
    );

    const target = await stories.findOne({ where: { visibility: StoryVisibility.PUBLISHED } });
    const adminUser = await runner.manager.getRepository(User).findOne({ where: {} });
    if (!target || !adminUser) throw new Error('need a published story and a user');
    console.log('story', target.id, 'admin', adminUser.id);

    const removed = await admin.remove(
      target.id,
      adminUser.id,
      StoryRemovalReason.OTHER,
      'smoke test',
    );
    console.log('after remove:', removed.visibility, removed.removal);
    const hidden = await history.getFromCatalog(target.id).then(
      () => 'visible (BAD)',
      () => 'hidden from the catalog',
    );
    console.log(hidden);

    const restored = await admin.restore(target.id, adminUser.id, 'false alarm');
    console.log('after restore:', restored.visibility, restored.removal);
    console.log(
      'history:',
      restored.moderationHistory.map((e) => [e.action, e.reason, e.note, e.admin?.userId]),
    );
    await history.getFromCatalog(target.id);
    console.log('back in the catalog');
  } finally {
    await runner.rollbackTransaction();
    await runner.release();
    await AppDataSource.destroy();
    console.log('rolled back');
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
