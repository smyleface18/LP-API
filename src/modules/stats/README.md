# StatsModule: estadísticas de los dashboards

Datos reales para el dashboard del jugador (tab Perfil de la app) y el del admin, calculados con SQL sobre las tablas de la trivia (`game`, `game_session`, `player_answer`, `question`, `category_question`), de los usuarios y de las historietas. No guarda nada: cada pedido consulta la base.

## Endpoints

Con `Authorization: Bearer <access token>`. Respuesta con el formato común `{ ok, data, message }`.

| Método y ruta      | Quién      | Qué devuelve                        |
| ------------------ | ---------- | ----------------------------------- |
| `GET /stats/me`    | Cualquiera | `PlayerStats` del usuario que pide. |
| `GET /admin/stats` | Solo ADMIN | `AdminStats` de toda la app.        |

## Qué se calcula

Los porcentajes son enteros (0–100) y valen 0 si no hay datos.

`PlayerStats`:

- `score`, `level`, `gamesPlayed`, `gamesWon`, `currentStreak`: los contadores del usuario (los actualiza `MatchResultsService` al terminar cada partida de trivia). `winRate` = ganadas / jugadas.
- `trivia`: respuestas del usuario en `player_answer` (vía sus `game_session`): cuántas, cuántas correctas, `accuracy` y cuántas categorías distintas practicó.
- `levels`: por nivel CEFR de la categoría de cada pregunta respondida, cuántas respondió y su `accuracy`. Solo los niveles que practicó.
- `stories`: historietas **publicadas** en las que participó, viñetas escritas, puntaje total y promedio por viñeta.

`AdminStats`:

- `users`: total, jugadores, admins, nuevos en los últimos 7 días y activos en los últimos 7 días (con una partida de trivia o una historieta en ese lapso). `activeRate` = activos / jugadores, como máximo 100 (un admin también puede jugar).
- `content`: preguntas y categorías.
- `trivia`: partidas guardadas, respuestas, `accuracy` (correctas / respondidas) y `winRate` (suma de ganadas / suma de jugadas de todos los usuarios).
- `stories`: total, publicadas, quitadas y viñetas.
- `levelUsage`: partidas de trivia + historietas publicadas por nivel, con el porcentaje del total.
- `categoryDistribution`: respuestas de trivia por categoría, de la que más tiene a la que menos.

Nota: los contadores `gamesPlayed`/`gamesWon` existen desde que se agregaron a `User`; las partidas anteriores no cuentan en `winRate`, aunque sus respuestas sí cuentan en `accuracy`.

## Pruebas

- `stats.service.spec.ts`: cómo se arman los resultados (conteos como string, porcentajes, 404, `activeRate` con tope), con la base mockeada.
- `test/stats-smoke.ts`: prueba manual de solo lectura contra el Postgres local (estadísticas del admin y de cada usuario, y los filtros del catálogo): `npx ts-node -r tsconfig-paths/register test/stats-smoke.ts`.
