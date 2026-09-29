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
| `story_like`        | "Me gusta" a la historieta completa: una fila por usuario y historieta (`story_id` + `user_id` únicos; FK a `story` y a `user` con `ON DELETE CASCADE`). |
| `story_participant` | Uno por jugador (`story_id` + `user_id` únicos, índice por `user_id`): nombre al jugar, puesto, viñetas, puntaje total y promedio, si salió. |

Se guardan **keys** de S3, no URLs: se firman al servir (`StoryUrlSigner`). El avatar de cada participante es el actual de su usuario. Migraciones: `1790569318301` (tablas), `1790621750135` (título), `1790623503236` (moderación) `1790628997226` (historial de moderación, con las ya quitadas cargadas como `REMOVED`) y `1790646704055` (likes).

Quiénes crearon una historieta: `story_participant` (cada jugador, con su puesto) y `story_panel.author_id` (el autor de cada viñeta).

## Endpoints

Con `Authorization: Bearer <access token>` (`JwtAuthGuard`). Respuesta con el formato común `{ ok, data, message }`.

| Método y ruta                  | Qué devuelve                                                                                   |
| ------------------------------ | ---------------------------------------------------------------------------------------------- |
| `GET /story/history?page&limit` | `StoryHistoryPage`: `{ items, page, limit, total }`, de la más reciente a la más vieja. `limit` hasta 50 (por defecto 20). |
| `GET /story/history/:storyId`  | `StoredStoryManifest`: el manifiesto de la historieta, con el mismo formato que `storyReviewReady` (ver README de `story-game`), más `likes: { count, likedByMe }` y `reactionOptions` (las reacciones permitidas). |

Cada `item` es `{ storyId, title, finishedAt, level, panelsCount, excerpt, coverImageUrl, players: [{ userId, name, avatarUrl }], myPosition, myScore, likes: { count, likedByMe } }`: `excerpt` es el texto de la primera viñeta y `coverImageUrl` la primera imagen firmada. Los likes de una página salen de una sola consulta agrupada.

Solo los participantes ven una historieta: a cualquier otro `GET /story/history/:storyId` le responde **404** (sin revelar que existe). Una historieta quitada por un admin ya no aparece en el historial (404 también).

### Catálogo

Cualquier usuario autenticado ve las historietas **publicadas** de todos los jugadores, apenas se guardan (al llegar a FINISHED, después del review), puede reaccionar a cada viñeta y darle like a la historieta completa (también a las del historial propio: usan estas mismas rutas).

| Método y ruta                        | Qué devuelve                                                                     |
| ------------------------------------ | -------------------------------------------------------------------------------- |
| `GET /story/catalog?page&limit&level&search` | `StoryHistoryPage`, de la más reciente a la más vieja. `level` filtra por uno o más niveles (`level=A1,A2` o repetido); `search` busca, sin distinguir mayúsculas, en el título, los nombres de los jugadores y el texto de las viñetas (`story-search.ts`, la misma búsqueda del panel de admin). Los ítems son como los del historial; `myPosition` es null si quien pide no jugó. |
| `GET /story/catalog/:storyId`        | `StoredStoryManifest` (manifiesto + likes + reacciones permitidas). 404 si no existe o fue quitada. |
| `PUT /story/catalog/:storyId/panels/:order/reaction` | Body `{ emoji }`: una de `STORY_REACTIONS` o `null` para quitar la propia. Devuelve `{ order, reactions }` de la viñeta. Mismo `UPDATE` atómico del jsonb que en la partida, con guarda de publicada: 404 si la viñeta no existe o la historieta fue quitada. |
| `PUT /story/catalog/:storyId/like`   | Da like (idempotente: repetirlo no suma). Devuelve `{ count, likedByMe }`. 404 si no está publicada. |
| `DELETE /story/catalog/:storyId/like` | Quita el like propio (si no había, no cambia nada). Devuelve `{ count, likedByMe }`. |

Si la historieta todavía está en Redis (review en vivo, 24 h), una reacción por REST se guarda en Postgres pero no se envía a la sala: los que siguen en el review en vivo la ven al abrir la historieta desde el historial o el catálogo.

### Moderación (solo ADMIN)

`JwtAuthGuard` + `RolesGuard` con el rol `ADMIN`.

| Método y ruta                             | Qué hace                                                                    |
| ----------------------------------------- | --------------------------------------------------------------------------- |
| `GET /admin/stories?page&limit&visibility&search` | `AdminStoryPage` con todas (publicadas y quitadas). `search` busca, sin distinguir mayúsculas, en el título, el código de la partida, los nombres de los jugadores y el texto de las viñetas (los `%` y `_` del texto se buscan literales). |
| `GET /admin/stories/:storyId`             | `AdminStoryDetail`: el ítem, el manifiesto completo (también de las quitadas) y `moderationHistory` (acciones, de la más reciente a la más vieja). |
| `POST /admin/stories/:storyId/remove`     | `{ reason, note? }`: la quita. `note` es obligatoria con `OTHER` (hasta 500). 409 si ya estaba quitada. |
| `POST /admin/stories/:storyId/restore`    | `{ note? }`: la vuelve a publicar. 409 si ya estaba publicada. |
| `POST /admin/stories/:storyId/regenerate-images` | Vuelve a dibujar las viñetas con texto que quedaron sin imagen (el proveedor falló o venció el plazo). Responde enseguida `{ queued, orders }`; las imágenes llegan después (ver abajo). |

Cada `AdminStoryItem` trae los jugadores con su cuenta actual (`currentUsername`, `email`) para contactarlos, y `removal: { removedAt, removedBy, reason, note }` si fue quitada.

Motivos (`StoryRemovalReason`): `INAPPROPRIATE_CONTENT`, `OFFENSIVE_LANGUAGE`, `PERSONAL_DATA`, `SPAM`, `OTHER`.

**Regenerar imágenes:** `StoryAdminService.regenerateMissingImages` emite `story.image-regeneration-requested` con una viñeta por imagen faltante (texto final, escenario, fichas del elenco). `StoryMediaQueue` crea una tarea `panel-image-regen` por cada una (id fijo `{gameId}__regen__{order}`: pedirla dos veces mientras está en la cola no la duplica; prioridad más baja que las partidas en curso) y `StoryMediaProcessor` la dibuja con los mismos reintentos. Al terminar emite `story.panel-image-regenerated`: `StoryHistoryService` guarda la key de S3 en `story_panel.imageKey`, y si el review en vivo sigue en Redis `StoryGameService` actualiza la viñeta y la sala recibe `panelMediaReady`. Si vuelve a fallar, la viñeta sigue sin imagen y se puede pedir otra vez.

**Quitar es un borrado lógico:** las keys de S3 se conservan, pero la historieta deja de aparecer en el catálogo y en el historial de sus jugadores; solo el admin la sigue viendo. **Restaurar** la vuelve a publicar y vacía los campos `removed*` de `story` (que son el estado actual). Cada acción se registra en `story_moderation_log` **en la misma transacción** que el cambio de estado, así el historial nunca queda desfasado. El `UPDATE` tiene guarda (solo cambia desde el estado contrario): si dos admins actúan a la vez, uno recibe 409. Si su review en vivo sigue en Redis (24 h), `StoryGameService.discardFinishedStory` borra la partida, para que nadie la siga viendo ni reaccionando por socket.

## Pruebas

- `story-history.mapper.spec.ts`: partida jugada con el harness → filas (estado de la media, ranking) → manifiesto e ítem del historial.
- `story-history.service.spec.ts`: transacción, idempotencia, reacciones (del socket y por REST), likes, 404 a no participantes, paginación, catálogo y que las quitadas no se sirvan (base mockeada).
- `test/story-game/engagement-smoke.ts`: prueba manual de reacciones y likes contra el Postgres local, dentro de una transacción que al final se deshace.
- `story-admin.service.spec.ts`: lista con filtros y búsqueda escapada, detalle con historial, quitar y restaurar (quién/por qué, historial en la transacción, guarda contra la carrera, 409, 404, Redis caído).
- Regenerar imágenes: `story-admin.service.spec.ts` (qué viñetas se piden y con qué datos), `story-history.service.spec.ts` (guardar la key), `story-game.media.spec.ts` (review en vivo en Redis) y `queue/story-media.queue.spec.ts` (tarea y processor).
- `dto/story-admin.dto.spec.ts`: motivo y nota (obligatoria con `OTHER`), filtros del admin, nivel del catálogo y reacción a una viñeta.
- `test/story-game/catalog-smoke.ts`: prueba manual de solo lectura contra el Postgres local (catálogo, búsqueda del admin y detalle).
- `test/story-game/moderation-smoke.ts`: prueba manual de quitar y restaurar contra el Postgres local, dentro de una transacción que al final se deshace.
- `test/story-game/history-smoke.ts`: prueba manual contra el Postgres local (guarda, lista, lee, reacciona y borra lo que creó). No corre con jest: `npx ts-node -r tsconfig-paths/register test/story-game/history-smoke.ts`.
