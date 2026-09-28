/**
 * Prueba manual de solo lectura contra el Postgres local (no corre con jest):
 * estadísticas del admin y de cada usuario, y los filtros del catálogo. Uso:
 *   npx ts-node -r tsconfig-paths/register test/stats-smoke.ts
 */
import 'reflect-metadata';
import { AppDataSource } from '@/db/data-source';
import { Story } from '@/db/entities';
import { Level } from '@/db/enum/question.enum';
import { StatsService } from '@/modules/stats/stats.service';
import { StoryHistoryService } from '@/modules/story-history/story-history.service';
import { StoryUrlSigner } from '@/modules/story-game/story-url-signer.service';

const signer = {
  avatarsFor: () => Promise.resolve({}),
  mediaFor: () => Promise.resolve({}),
  signMedia: () => Promise.resolve({ audioUrl: null, imageUrl: null }),
} as unknown as StoryUrlSigner;

async function main() {
  await AppDataSource.initialize();
  try {
    const stats = new StatsService(AppDataSource);
    console.log('admin', JSON.stringify(await stats.admin(), null, 1));

    const users: { id: string; username: string }[] = await AppDataSource.query(
      `SELECT "id", "username" FROM "user" ORDER BY "createdAt"`,
    );
    for (const user of users) {
      console.log(user.username, JSON.stringify(await stats.player(user.id)));
    }

    const history = new StoryHistoryService(AppDataSource.getRepository(Story), signer);
    const all = await history.listCatalog('nobody', 1, 50);
    console.log(
      'catalog all',
      all.total,
      all.items.map((i) => i.level),
    );
    const a2 = await history.listCatalog('nobody', 1, 50, { levels: [Level.A2] });
    console.log('catalog A2', a2.total, [...new Set(a2.items.map((i) => i.level))]);
    const several = await history.listCatalog('nobody', 1, 50, {
      levels: [Level.A1, Level.A2, Level.B1],
    });
    console.log('catalog A1/A2/B1', several.total);
    const word = all.items[0]?.players[0]?.name ?? 'x';
    const byPlayer = await history.listCatalog('nobody', 1, 50, { search: word });
    console.log(`catalog search "${word}"`, byPlayer.total);
    const nothing = await history.listCatalog('nobody', 1, 50, { search: 'zzz-no-match-zzz' });
    console.log('catalog search none', nothing.total);
  } finally {
    await AppDataSource.destroy();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
