# StoryHistoryModule: historial, catálogo y moderación del modo Historieta

Guarda en Postgres cada historieta terminada y la sirve por REST: a sus participantes (historial), a todos los usuarios (catálogo) y a los admins (moderación). Redis tiene la partida 24 h para el review en vivo (socket `/story`); después solo existe acá.

## Cuándo se guarda

`StoryHistoryService` escucha dos eventos internos de `story-game`:

- `story.finished` (la partida entró a FINISHED, con toda la media terminada): guarda la historieta, sus viñetas y sus participantes **en una transacción**. Es idempotente: si el `storyId` ya existe no hace nada. Un error queda en el log y no afecta a la partida.
- `story.panel-reaction`: las reacciones siguen abiertas en FINISHED, así que se reflejan en la viñeta guardada con un `UPDATE` atómico del jsonb (`reactions || {userId: emoji}`, o `reactions - userId` si se quitó). Antes de FINISHED no hay fila y no cambia nada: las reacciones se guardan con la historieta.

El id de la historieta es el `storyId` que la partida recibe al empezar la generación de media: el `storyId` del manifiesto del review es el mismo que el del historial.

## Tablas

| Tabla               | Contenido                                                                                           |
| ------------------- | --------------------------------------------------------------------------------------------------- |
| `story`             | `gameId` (único), `title` (el que puso la IA; null si no hubo), nivel, idioma, viñetas configuradas, elenco (jsonb), `finishedAt` y la moderación: `visibility` (`PUBLISHED`/`REMOVED`, índice con `finishedAt`), `removedAt`, `removed_by_id` (el admin, FK a `user` con `ON DELETE SET NULL`), `removalReason` y `removalNote`. |
| `story_panel`       | Una por viñeta (`story_id` + `order` únicos): autor (y su nombre al jugar), texto original y final, escenario, personajes, correcciones, puntaje, reacciones (jsonb), `mediaStatus` y keys de S3 del audio y la imagen, speech marks. |
| `story_moderation_log` | Historial de moderación: una fila por cada vez que un admin quitó (`REMOVED`) o restauró (`RESTORED`) una historieta, con `admin_id` (FK a `user`, `SET NULL`), motivo (al quitar), nota y fecha. Índice por `story_id` + fecha. |
| `story_participant` | Uno por jugador (`story_id` + `user_id` únicos, índice por `user_id`): nombre al jugar, puesto, viñetas, puntaje total y promedio, si salió. |

Se guardan **keys** de S3, no URLs: se firman al servir (`StoryUrlSigner`). El avatar de cada participante es el actual de su usuario. Migraciones: `1790569318301` (tablas), `1790621750135` (título), `1790623503236` (moderación) y `1790628997226` (historial de moderación, con las ya quitadas cargadas como `REMOVED`).

Quiénes crearon una historieta: `story_participant` (cada jugador, con su puesto) y `story_panel.author_id` (el autor de cada viñeta).

## Endpoints

Con `Authorization: Bearer <access token>` (`JwtAuthGuard`). Respuesta con el formato común `{ ok, data, message }`.

| Método y ruta                  | Qué devuelve                                                                                   |
| ------------------------------ | ---------------------------------------------------------------------------------------------- |
| `GET /story/history?page&limit` | `StoryHistoryPage`: `{ items, page, limit, total }`, de la más reciente a la más vieja. `limit` hasta 50 (por defecto 20). |
| `GET /story/history/:storyId`  | El manifiesto de la historieta, con el mismo formato que `storyReviewReady` (ver README de `story-game`). |

Cada `item` es `{ storyId, title, finishedAt, level, panelsCount, excerpt, coverImageUrl, players: [{ userId, name, avatarUrl }], myPosition, myScore }`: `excerpt` es el texto de la primera viñeta y `coverImageUrl` la primera imagen firmada.

Solo los participantes ven una historieta: a cualquier otro `GET /story/history/:storyId` le responde **404** (sin revelar que existe). Una historieta quitada por un admin ya no aparece en el historial (404 también).

### Catálogo

Cualquier usuario autenticado ve las historietas **publicadas** de todos los jugadores, apenas se guardan (al llegar a FINISHED, después del review). Solo lectura.

| Método y ruta                        | Qué devuelve                                                                     |
| ------------------------------------ | -------------------------------------------------------------------------------- |
| `GET /story/catalog?page&limit&level&search` | `StoryHistoryPage`, de la más reciente a la más vieja. `level` filtra por uno o más niveles (`level=A1,A2` o repetido); `search` busca, sin distinguir mayúsculas, en el título, los nombres de los jugadores y el texto de las viñetas (`story-search.ts`, la misma búsqueda del panel de admin). Los ítems son como los del historial; `myPosition` es null si quien pide no jugó. |
| `GET /story/catalog/:storyId`        | El manifiesto. 404 si no existe o fue quitada.                                    |

### Moderación (solo ADMIN)

`JwtAuthGuard` + `RolesGuard` con el rol `ADMIN`.

| Método y ruta                             | Qué hace                                                                    |
| ----------------------------------------- | --------------------------------------------------------------------------- |
| `GET /admin/stories?page&limit&visibility&search` | `AdminStoryPage` con todas (publicadas y quitadas). `search` busca, sin distinguir mayúsculas, en el título, el código de la partida, los nombres de los jugadores y el texto de las viñetas (los `%` y `_` del texto se buscan literales). |
| `GET /admin/stories/:storyId`             | `AdminStoryDetail`: el ítem, el manifiesto completo (también de las quitadas) y `moderationHistory` (acciones, de la más reciente a la más vieja). |
| `POST /admin/stories/:storyId/remove`     | `{ reason, note? }`: la quita. `note` es obligatoria con `OTHER` (hasta 500). 409 si ya estaba quitada. |
| `POST /admin/stories/:storyId/restore`    | `{ note? }`: la vuelve a publicar. 409 si ya estaba publicada. |

Cada `AdminStoryItem` trae los jugadores con su cuenta actual (`currentUsername`, `email`) para contactarlos, y `removal: { removedAt, removedBy, reason, note }` si fue quitada.

Motivos (`StoryRemovalReason`): `INAPPROPRIATE_CONTENT`, `OFFENSIVE_LANGUAGE`, `PERSONAL_DATA`, `SPAM`, `OTHER`.

**Quitar es un borrado lógico:** las keys de S3 se conservan, pero la historieta deja de aparecer en el catálogo y en el historial de sus jugadores; solo el admin la sigue viendo. **Restaurar** la vuelve a publicar y vacía los campos `removed*` de `story` (que son el estado actual). Cada acción se registra en `story_moderation_log` **en la misma transacción** que el cambio de estado, así el historial nunca queda desfasado. El `UPDATE` tiene guarda (solo cambia desde el estado contrario): si dos admins actúan a la vez, uno recibe 409. Si su review en vivo sigue en Redis (24 h), `StoryGameService.discardFinishedStory` borra la partida, para que nadie la siga viendo ni reaccionando por socket.

## Pruebas

- `story-history.mapper.spec.ts`: partida jugada con el harness → filas (estado de la media, ranking) → manifiesto e ítem del historial.
- `story-history.service.spec.ts`: transacción, idempotencia, reacciones, 404 a no participantes, paginación, catálogo y que las quitadas no se sirvan (base mockeada).
- `story-admin.service.spec.ts`: lista con filtros y búsqueda escapada, detalle con historial, quitar y restaurar (quién/por qué, historial en la transacción, guarda contra la carrera, 409, 404, Redis caído).
- `dto/story-admin.dto.spec.ts`: motivo y nota (obligatoria con `OTHER`), filtros del admin y nivel del catálogo.
- `test/story-game/catalog-smoke.ts`: prueba manual de solo lectura contra el Postgres local (catálogo, búsqueda del admin y detalle).
- `test/story-game/moderation-smoke.ts`: prueba manual de quitar y restaurar contra el Postgres local, dentro de una transacción que al final se deshace.
- `test/story-game/history-smoke.ts`: prueba manual contra el Postgres local (guarda, lista, lee, reacciona y borra lo que creó). No corre con jest: `npx ts-node -r tsconfig-paths/register test/story-game/history-smoke.ts`.
