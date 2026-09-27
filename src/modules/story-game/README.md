# StoryGameModule: modo Historieta (`/story`)

Varios jugadores escriben una historieta en inglés, una viñeta por turno. Los personajes se crean durante los turnos. Este módulo tiene el namespace de Socket.IO `/story`, la máquina de estados, el estado compartido en Redis y las tareas diferidas en BullMQ.

Estado actual: **Fase 1** (lobby). Turnos y personajes, revisión con IA, audio y review llegan en fases siguientes.

## Archivos

| Archivo                     | Rol                                                                             |
| --------------------------- | ------------------------------------------------------------------------------- |
| `story-game.gateway.ts`     | Namespace `/story`: autentica, traduce eventos y difunde. Sin reglas.            |
| `story-game.service.ts`     | Máquina de estados y reglas del juego.                                          |
| `story-state.repository.ts` | Lectura/escritura en Redis (hashes, scripts Lua, referencia usuario → partida). |
| `story-game.config.ts`      | Todos los números del modo (jugadores, rangos, límites de texto y personajes).  |
| `domain/`                   | Tipos, errores (`StoryError` con `code`) y vistas que se envían al cliente.     |
| `dto/`                      | DTOs de los eventos con `class-validator`.                                      |
| `story-validation.pipe.ts`  | `ValidationPipe` del gateway; los errores salen como `VALIDATION_ERROR`.         |
| `queue/`                    | Cola BullMQ `story-turn-timeout`: tareas diferidas con el patrón `dueAt + seq`.  |

## Estados

```text
LOBBY → PLAYING → PROCESSING → REVIEW → FINISHED
LOBBY/PLAYING → ABANDONED (nadie conectado durante 60 s, o todos salieron)
```

PROCESSING y REVIEW nunca se abandonan: la historieta se termina de generar y se guarda en el historial aunque todos se hayan ido.

Solo el servidor cambia el estado. Un evento que no corresponde al estado actual devuelve `INVALID_STATE`.

## Estado en Redis

TTL: `MATCH_TTL` (se renueva en cada escritura). Todas las claves de una partida comparten el hash tag `{gameId}`.

```text
story:{gameId}              hash: status, hostId, config (json), players (json, en orden de entrada),
                            currentPanel, turnEndsAt, abandonAt, abandonSeq, createdAt
story:{gameId}:characters   hash: characterId → { name, kind, description, id, createdBy, introducedInPanel }
story:{gameId}:panels       hash: order → viñeta (json)   (desde la Fase 2)
story:{gameId}:lock         lock de la partida (RedisLockService)
user:{userId}:story         partida activa del usuario (reconexión, una partida a la vez)
```

Cada cambio pasa por `StoryGameService.mutate`: toma el lock de la partida, lee, valida y modifica, y guarda con `StoryStateRepository.save`. `save` es un script Lua que escribe solo si el lock sigue siendo nuestro (fencing, como `MatchStore.save`). Después sincroniza las tareas diferidas.

El elenco solo crece: los personajes son inmutables una vez agregados, porque otras viñetas dependen de ellos.

## Tareas diferidas (cola `story-turn-timeout`)

Mismo patrón que la trivia (`GameTimeoutQueue`): el servicio emite `story.schedule` con `{ gameId, kind, seq, dueAt }`. `StoryTimeoutQueue` crea una tarea con delay y un id fijo, y `StoryTimeoutProcessor` llama al servicio cuando vence. Una tarea vale solo si su `seq` coincide con el de la partida; si no, se descarta. Cuando una tarea queda obsoleta, el servicio también emite `story.cancel` para borrarla, pero eso es solo limpieza: la garantía es el chequeo de `seq`.

| `kind`          | `seq`        | Qué hace                                                                    |
| --------------- | ------------ | --------------------------------------------------------------------------- |
| `abandon-idle`  | `abandonSeq` | Si la partida (LOBBY o PLAYING) sigue sin nadie conectado a los 60 s, pasa a ABANDONED. |
| `close-turn`    | viñeta       | (Fase 2) Cierra el turno por tiempo.                                        |

## Eventos

Autenticación: token de Cognito en `handshake.auth.token` (`WsAuthService.authenticateSocket`). Cada socket entra además a su sala personal `user:{userId}`. Con ella el servidor le habla a un usuario, o saca de una sala a todos sus sockets, en cualquier instancia: `KICKED`, `leaveGame` y, desde la Fase 2, los eventos que van solo al autor.

La partida actual de cada usuario no se guarda en el socket: el gateway la lee de Redis (`user:{userId}:story`) en cada evento, así nunca queda desactualizada (por ejemplo, si lo expulsan desde otra instancia).

Los errores van por el ack si el cliente lo envió; si no, por `storyError`: `{ ok: false, status, message, code }`.

| Evento            | Dirección          | Payload / notas                                                                     |
| ----------------- | ------------------ | ----------------------------------------------------------------------------------- |
| `createStoryGame` | cliente → servidor | Sin payload. Ack: `LobbyView`.                                                      |
| `joinStoryGame`   | cliente → servidor | `{ gameId }`. Solo en LOBBY; si ya era jugador, reconecta sin cambiar el orden.     |
| `updateConfig`    | cliente → servidor | Anfitrión, LOBBY. Parcial: `{ panelsCount?, turnDurationSec?, level?, language? }`. |
| `kickPlayer`      | cliente → servidor | Anfitrión, LOBBY. `{ userId }`. El expulsado recibe `storyError` con `code: 'KICKED'`. |
| `startStory`      | cliente → servidor | Anfitrión. LOBBY → PLAYING.                                                         |
| `leaveGame`       | cliente → servidor | Sin payload.                                                                        |
| `lobbyUpdated`    | servidor → sala    | `{ gameId, status, hostId, config, players: [{ userId, username, connected, left }] }` |
| `storyError`      | servidor → emisor  | `{ ok: false, status, message, code }`                                              |

Códigos de error: `VALIDATION_ERROR`, `USER_NOT_FOUND`, `GAME_NOT_FOUND`, `NOT_IN_GAME`, `ALREADY_IN_GAME`, `NOT_A_PLAYER`, `NOT_HOST`, `INVALID_STATE`, `GAME_FULL`, `NOT_ENOUGH_PLAYERS`, `NOT_ENOUGH_PANELS`, `CANNOT_KICK_SELF`, `KICKED`.

## Reglas de la Fase 1

- Configuración por defecto: 6 viñetas, 90 s por turno, nivel A2, `en-US`. Rangos en `story-game.config.ts`.
- 2 a 6 jugadores. El orden de entrada define los turnos: la viñeta `i` es de `players[i % players.length]`.
- `startStory` exige al menos 2 jugadores conectados y `panelsCount >= cantidad de jugadores` (todos escriben al menos una viñeta; los desconectados también cuentan).
- Un usuario no puede estar en dos partidas activas a la vez (`ALREADY_IN_GAME`).
- Desconexión: el jugador queda `connected: false` y vuelve al reconectarse (a cualquier instancia).
- Si el anfitrión se desconecta o sale, el anfitrión pasa al siguiente jugador conectado en orden (circular). No se devuelve al reconectarse. Si no había nadie conectado, lo recibe el primero que vuelve.
- Salir en LOBBY quita al jugador. Salir después lo marca `left: true` y lo deja en la lista, porque el orden define los turnos.
- LOBBY o PLAYING sin nadie conectado: se programa `abandon-idle` a 60 s; si alguien vuelve o se une, se invalida. El margen evita que un redeploy, que corta todos los sockets a la vez, mate las partidas en curso.
- Si ya nadie puede volver (el lobby quedó sin jugadores, o en PLAYING todos salieron), se abandona en el acto.
- PROCESSING y REVIEW nunca se abandonan.

## Pruebas

- `story-game.service.spec.ts`: reglas y máquina de estados, con un repositorio en memoria en lugar de Redis y el reloj controlado.
- `story-state.repository.spec.ts`: formato de las claves y de los scripts, con el cliente Redis mockeado. Incluye un bloque contra un Redis real que se salta si no hay `REDIS_TEST_URL`.
- `queue/story-timeout.queue.spec.ts`: id fijo de la tarea, delay y cancelación.
- `story-game.gateway.spec.ts`: salas personales, partida leída de Redis, `KICKED` y salida de la sala.
- `dto/story-dtos.spec.ts`: rangos de configuración y payloads a través del pipe del gateway.
