import { ObjectLiteral, SelectQueryBuilder } from 'typeorm';

/** Escapa `%`, `_` y `\` para buscar el texto del usuario tal cual dentro de un ILIKE. */
export const likePattern = (search: string) =>
  `%${search.replace(/[\\%_]/g, (char) => `\\${char}`)}%`;

/**
 * Filtra las historietas (alias `story`) cuyo título, nombre de algún jugador
 * o texto de alguna viñeta contiene `search`, sin distinguir mayúsculas.
 * Con `includeGameId` también busca en el código de la partida (panel de admin).
 * Los EXISTS evitan filas repetidas por los joins de la consulta.
 */
export function whereStoryMatches<T extends ObjectLiteral>(
  query: SelectQueryBuilder<T>,
  search: string,
  { includeGameId = false } = {},
): SelectQueryBuilder<T> {
  return query.andWhere(
    `(story.title ILIKE :search${includeGameId ? ' OR story.gameId ILIKE :search' : ''}
      OR EXISTS (SELECT 1 FROM "story_participant" sp
                 WHERE sp."story_id" = story.id AND sp."username" ILIKE :search)
      OR EXISTS (SELECT 1 FROM "story_panel" sp2
                 WHERE sp2."story_id" = story.id AND sp2."finalText" ILIKE :search))`,
    { search: likePattern(search) },
  );
}
