/**
 * Prueba manual del catálogo y del panel de admin contra el Postgres local (no
 * corre con jest). Solo lee: lista el catálogo, busca como admin y abre el
 * detalle de la primera historieta. Uso:
 *   npx ts-node -r tsconfig-paths/register test/story-game/catalog-smoke.ts
 */
import 'reflect-metadata';
import { AppDataSource } from '@/db/data-source';
import { Story, StoryModerationLog } from '@/db/entities';
import { StoryVisibility } from '@/db/enum/story.enum';
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
  try {
    const stories = AppDataSource.getRepository(Story);
    const history = new StoryHistoryService(stories, signer);
    const admin = new StoryAdminService(
      stories,
      AppDataSource.getRepository(StoryModerationLog),
      history,
      {} as StoryGameService,
    );

    const catalog = await history.listCatalog('nobody', 1, 5);
    console.log(
      'catalog total',
      catalog.total,
      catalog.items.map((i) => i.title ?? i.excerpt),
    );

    const all = await admin.list({ page: 1, limit: 5 });
    console.log('admin total', all.total);
    const removed = await admin.list({ page: 1, limit: 5, visibility: StoryVisibility.REMOVED });
    console.log('admin removed', removed.total);

    const first = all.items[0];
    if (first) {
      const word = (first.title ?? first.excerpt).split(' ')[0] ?? '';
      const found = await admin.list({ page: 1, limit: 5, search: word });
      console.log(
        `search "${word}"`,
        found.total,
        found.items.map((i) => i.storyId === first.storyId),
      );
      const byPlayer = await admin.list({
        page: 1,
        limit: 5,
        search: first.participants[0]?.username,
      });
      console.log('search player', byPlayer.total);
      const escaped = await admin.list({ page: 1, limit: 5, search: '%_%' });
      console.log('search "%_%" (literal)', escaped.total);

      const detail = await admin.get(first.storyId);
      console.log(
        'detail',
        detail.title,
        detail.participants.map((p) => [p.username, !!p.email]),
        detail.manifest.panels.length,
      );
      const fromCatalog = await history.getFromCatalog(first.storyId);
      console.log('catalog detail panels', fromCatalog.panels.length);
    }
  } finally {
    await AppDataSource.destroy();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
