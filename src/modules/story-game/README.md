# StoryGameModule: modo Historieta (`/story`)

Varios jugadores escriben una historieta en inglés, una viñeta por turno. Este módulo tiene el namespace de Socket.IO `/story`, la máquina de estados y el estado compartido en Redis.

Estado actual: **Fase 1** (lobby y personajes). Turnos, revisión con IA, audio y review llegan en fases siguientes.

## Archivos

| Archivo                   | Rol                                                                          |
| ------------------------- | ---------------------------------------------------------------------------- |
| `story-game.gateway.ts`   | Namespace `/story`: autentica, traduce eventos y difunde. Sin reglas.         |
| `story-game.service.ts`   | Máquina de estados y reglas del juego.                                       |
| `story-state.repository.ts` | Lectura/escritura en Redis (hashes, scripts Lua, referencia usuario → partida). |
| `story-game.config.ts`    | Todos los números del modo (jugadores, rangos, límites de texto y ficha).    |
| `domain/`                 | Tipos, errores (`StoryError` con `code`) y vistas que se envían al cliente.  |
| `dto/`                    | DTOs de los eventos con `class-validator`.                                   |
| `story-validation.pipe.ts`| `ValidationPipe` del gateway; los errores salen como `VALIDATION_ERROR`.      |

## Estados

```text
LOBBY → CHARACTERS → PLAYING → PROCESSING → REVIEW → FINISHED
cualquier estado → ABANDONED (no quedan jugadores conectados)
```

Solo el servidor cambia el estado. Un evento que no corresponde al estado actual devuelve `INVALID_STATE`.

## Estado en Redis

TTL: `MATCH_TTL` (se renueva en cada escritura). Todas las claves comparten el hash tag `{gameId}`.

```text
story:{gameId}              hash: status, hostId, config (json), players (json, en orden de entrada),
                            currentPanel, turnEndsAt, createdAt
story:{gameId}:characters   hash: userId → ficha (json)
story:{gameId}:panels       hash: order → viñeta (json)   (desde la Fase 2)
story:{gameId}:lock         lock de la partida (RedisLockService)
user:{userId}:story         partida activa del usuario (reconexión, una partida a la vez)
```

Cada cambio pasa por `StoryGameService.mutate`: toma el lock de la partida, lee, valida y modifica, y guarda con `StoryStateRepository.save`. `save` es un script Lua que escribe solo si el lock sigue siendo nuestro (fencing, como `MatchStore.save`). Si el lock se perdió, lanza `StoryLockLostError` y no escribe nada.

## Eventos

Autenticación: token de Cognito en `handshake.auth.token` (`WsAuthService.authenticateSocket`).

Los errores van por el ack si el cliente lo envió; si no, por `storyError`: `{ ok: false, status, message, code }`.

| Evento              | Dirección         | Payload / notas                                                                 |
| ------------------- | ----------------- | ------------------------------------------------------------------------------- |
| `createStoryGame`   | cliente → servidor | Sin payload. Ack: `LobbyView`.                                                  |
| `joinStoryGame`     | cliente → servidor | `{ gameId }`. Solo en LOBBY; si ya era jugador, reconecta sin cambiar el orden. |
| `updateConfig`      | cliente → servidor | Anfitrión, LOBBY. Parcial: `{ panelsCount?, turnDurationSec?, level?, language? }`. |
| `startCharacters`   | cliente → servidor | Anfitrión. LOBBY → CHARACTERS. Mínimo 2 jugadores.                              |
| `createCharacter`   | cliente → servidor | `{ name, type, trait, clothing, detail }`. Reemplaza la ficha anterior.         |
| `startStory`        | cliente → servidor | Anfitrión. CHARACTERS → PLAYING. Todos los jugadores deben tener personaje.     |
| `leaveGame`         | cliente → servidor | Sin payload.                                                                    |
| `lobbyUpdated`      | servidor → sala    | `{ gameId, status, hostId, config, players: [{ userId, username, connected, left, hasCharacter }] }` |
| `charactersUpdated` | servidor → sala    | `{ gameId, characters: [{ userId, username, ...ficha }], missing: userId[] }`   |
| `storyError`        | servidor → emisor  | `{ ok: false, status, message, code }`                                          |

Códigos de error: `VALIDATION_ERROR`, `USER_NOT_FOUND`, `GAME_NOT_FOUND`, `NOT_IN_GAME`, `ALREADY_IN_GAME`, `NOT_A_PLAYER`, `NOT_HOST`, `INVALID_STATE`, `GAME_FULL`, `NOT_ENOUGH_PLAYERS`, `CHARACTERS_MISSING`.

## Reglas de la Fase 1

- Configuración por defecto: 6 viñetas, 90 s por turno, nivel A2, `en-US`. Rangos en `story-game.config.ts`.
- 2 a 6 jugadores. El orden de entrada define los turnos: la viñeta `i` es de `players[i % players.length]`.
- Un usuario no puede estar en dos partidas activas a la vez (`ALREADY_IN_GAME`).
- Desconexión: el jugador queda `connected: false` y vuelve al reconectarse (a cualquier instancia).
- Si el anfitrión se desconecta o sale, el anfitrión pasa al siguiente jugador conectado en orden (circular). No se devuelve al reconectarse.
- Salir en LOBBY/CHARACTERS quita al jugador y su ficha. Salir después lo marca `left: true` y lo deja en la lista, porque el orden define los turnos.
- Sin jugadores conectados → ABANDONED.

## Pruebas

- `story-game.service.spec.ts`: reglas y máquina de estados, con un repositorio en memoria en lugar de Redis.
- `story-state.repository.spec.ts`: formato de las claves y de los scripts, con el cliente Redis mockeado. Incluye un bloque contra un Redis real que se salta si no hay `REDIS_TEST_URL`.
- `dto/story-dtos.spec.ts`: rangos de configuración y ficha a través del pipe del gateway.
