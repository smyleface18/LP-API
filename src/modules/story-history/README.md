# StoryHistoryModule: historial del modo Historieta (Fase 4c)

Guarda en Postgres cada historieta terminada y la sirve a sus participantes por REST. Redis tiene la partida 24 h para el review en vivo (socket `/story`); después solo existe acá.

## Cuándo se guarda

`StoryHistoryService` escucha dos eventos internos de `story-game`:

- `story.finished` (la partida entró a FINISHED, con toda la media terminada): guarda la historieta, sus viñetas y sus participantes **en una transacción**. Es idempotente: si el `storyId` ya existe no hace nada. Un error queda en el log y no afecta a la partida.
- `story.panel-reaction`: las reacciones siguen abiertas en FINISHED, así que se reflejan en la viñeta guardada con un `UPDATE` atómico del jsonb (`reactions || {userId: emoji}`, o `reactions - userId` si se quitó). Antes de FINISHED no hay fila y no cambia nada: las reacciones se guardan con la historieta.

El id de la historieta es el `storyId` que la partida recibe al empezar la generación de media: el `storyId` del manifiesto del review es el mismo que el del historial.

## Tablas

| Tabla               | Contenido                                                                                           |
| ------------------- | --------------------------------------------------------------------------------------------------- |
| `story`             | `gameId` (único), `title` (el que puso la IA; null si no hubo), nivel, idioma, viñetas configuradas, elenco (jsonb) y `finishedAt`. |
| `story_panel`       | Una por viñeta (`story_id` + `order` únicos): autor (y su nombre al jugar), texto original y final, escenario, personajes, correcciones, puntaje, reacciones (jsonb), `mediaStatus` y keys de S3 del audio y la imagen, speech marks. |
| `story_participant` | Uno por jugador (`story_id` + `user_id` únicos, índice por `user_id`): nombre al jugar, puesto, viñetas, puntaje total y promedio, si salió. |

Se guardan **keys** de S3, no URLs: se firman al servir (`StoryUrlSigner`). El avatar de cada participante es el actual de su usuario. Migración: `1790569318301-Migration.ts`.

## Endpoints

Con `Authorization: Bearer <access token>` (`JwtAuthGuard`). Respuesta con el formato común `{ ok, data, message }`.

| Método y ruta                  | Qué devuelve                                                                                   |
| ------------------------------ | ---------------------------------------------------------------------------------------------- |
| `GET /story/history?page&limit` | `StoryHistoryPage`: `{ items, page, limit, total }`, de la más reciente a la más vieja. `limit` hasta 50 (por defecto 20). |
| `GET /story/history/:storyId`  | El manifiesto de la historieta, con el mismo formato que `storyReviewReady` (ver README de `story-game`). |

Cada `item` es `{ storyId, title, finishedAt, level, panelsCount, excerpt, coverImageUrl, players: [{ userId, name, avatarUrl }], myPosition, myScore }`: `excerpt` es el texto de la primera viñeta y `coverImageUrl` la primera imagen firmada.

Solo los participantes ven una historieta: a cualquier otro `GET /story/history/:storyId` le responde **404** (sin revelar que existe).

## Pruebas

- `story-history.mapper.spec.ts`: partida jugada con el harness → filas (estado de la media, ranking) → manifiesto e ítem del historial.
- `story-history.service.spec.ts`: transacción, idempotencia, reacciones, 404 a no participantes y paginación (base mockeada).
- `test/story-game/history-smoke.ts`: prueba manual contra el Postgres local (guarda, lista, lee, reacciona y borra lo que creó). No corre con jest: `npx ts-node -r tsconfig-paths/register test/story-game/history-smoke.ts`.
