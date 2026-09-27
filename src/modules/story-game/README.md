# StoryGameModule: modo Historieta (`/story`)

Varios jugadores escriben una historieta en inglés, una viñeta por turno. Los personajes se crean durante los turnos. Este módulo tiene el namespace de Socket.IO `/story`, la máquina de estados, el estado compartido en Redis y las tareas diferidas en BullMQ.

Estado actual: **Fase 2** (lobby, turnos y personajes, con un revisor de inglés falso que no encuentra errores). La revisión con IA y la puntuación (Fase 3), y el audio y el review (Fase 4), llegan en fases siguientes.

## Archivos

| Archivo                     | Rol                                                                                   |
| --------------------------- | ------------------------------------------------------------------------------------- |
| `story-game.gateway.ts`     | Namespace `/story`: autentica, traduce eventos y difunde. Sin reglas.                  |
| `story-game.service.ts`     | Máquina de estados y orquestación (lock, guardado, timers, eventos).                  |
| `domain/story-turns.ts`     | Reglas de los turnos como funciones puras: autor, apertura, cierre, validación.       |
| `story-state.repository.ts` | Lectura/escritura en Redis (hashes, scripts Lua con guarda, referencia usuario → partida). |
| `story-game.config.ts`      | Todos los números del modo (jugadores, rangos, límites de texto y personajes).        |
| `domain/`                   | Tipos, errores (`StoryError` con `code`), eventos internos y vistas para el cliente.  |
| `dto/`                      | DTOs de los eventos con `class-validator`.                                            |
| `story-validation.pipe.ts`  | `ValidationPipe` del gateway; los errores salen como `VALIDATION_ERROR`.               |
| `queue/`                    | Cola BullMQ `story-turn-timeout`: tareas diferidas con el patrón `dueAt + seq`.        |

La revisión de inglés la hace `LanguageReviewer` (`src/modules/language-review/`), una clase abstracta que sirve de token de inyección. En la Fase 2 la implementación es `NoErrorsLanguageReviewer`.

## Estados

```text
LOBBY → PLAYING → PROCESSING → REVIEW → FINISHED
LOBBY/PLAYING → ABANDONED (nadie conectado durante 60 s, o ya nadie puede volver)
```

PROCESSING y REVIEW nunca se abandonan: la historieta se termina de generar y se guarda en el historial aunque todos se hayan ido.

Solo el servidor cambia el estado. Un evento que no corresponde al estado actual devuelve `INVALID_STATE`.

## Estado en Redis

TTL: `MATCH_TTL` (se renueva en cada escritura). Todas las claves de una partida comparten el hash tag `{gameId}`.

```text
story:{gameId}              hash: status, hostId, config (json), players (json, en orden de entrada),
                            currentPanel, turnEndsAt, abandonAt, abandonSeq, createdAt
story:{gameId}:characters   hash: characterId → { id, name, kind, description, createdBy, introducedInPanel }
story:{gameId}:panels       hash: order → viñeta (PanelState, json)
story:{gameId}:lock         lock de la partida (RedisLockService)
user:{userId}:story         partida activa del usuario (reconexión, una partida a la vez)
```

Cada cambio pasa por `StoryGameService.mutate`: toma el lock de la partida, lee, valida y modifica, y guarda con `StoryStateRepository.save`. Después sincroniza las tareas diferidas y publica los eventos internos. `save` es un script Lua que:

1. escribe solo si el lock sigue siendo nuestro (fencing, como `MatchStore.save`);
2. si la escritura lleva **guarda**, verifica en el mismo script que la viñeta siga `open` (y, si se indica, que su revisión en curso sea el mismo `attemptId`). Si no se cumple, no escribe nada.

La guarda es lo que hace que un turno se cierre **una sola vez**: confirmar y el timeout usan el mismo cierre con guarda, así que aunque llegaran juntos sin el lock, Redis rechaza el segundo.

El elenco solo crece: los personajes son inmutables una vez agregados, porque otras viñetas dependen de ellos. Su id es `ch-{viñeta}-{índice}`.

## Tareas diferidas (cola `story-turn-timeout`)

Mismo patrón que la trivia (`GameTimeoutQueue`): el servicio emite `story.schedule` con `{ gameId, kind, seq, dueAt }`. `StoryTimeoutQueue` crea una tarea con delay y un id fijo, y `StoryTimeoutProcessor` llama al servicio cuando vence. El servicio compara las tareas que corresponden al estado anterior y al nuevo: programa las nuevas y emite `story.cancel` para las que quedaron obsoletas. Borrarlas es solo limpieza: la garantía es que cada tarea se valida al correr.

| `kind`         | `seq`        | Vale si…                                                    | Qué hace                                         |
| -------------- | ------------ | ----------------------------------------------------------- | ------------------------------------------------ |
| `abandon-idle` | `abandonSeq` | LOBBY/PLAYING, mismo `abandonSeq`, nadie conectado          | Pasa a ABANDONED.                                |
| `close-turn`   | viñeta       | PLAYING, `currentPanel = seq`, `turnEndsAt = dueAt`, abierta | Cierra el turno por tiempo (confirma o rellena). |

## Turnos

1. **Abrir.** Al entrar a PLAYING, y al cerrar cada turno, se abre la viñeta siguiente: `turnEndsAt = ahora + turnDurationSec`, se programa `close-turn` y se emite `turnStarted`. La viñeta `i` es de `players[i % n]`; si ese jugador abandonó, es del siguiente en orden (conectado; si no hay, el siguiente que no abandonó).
2. **Borrador** (`submitPanelDraft`). Se hace en tres pasos, para no tener el lock tomado mientras se espera a la IA:
   - a) Con lock: valida el turno y el borrador, y marca la viñeta como "en revisión" con un `attemptId`. Mientras tanto se rechaza otro borrador o confirmar (`REVIEW_IN_PROGRESS`), salvo que la revisión tenga más de `REVIEW_STALE_MS` (se da por perdida).
   - b) Sin lock: revisa el inglés.
   - c) Con lock y guarda (`attemptId`): guarda el resultado solo si la viñeta sigue abierta y la revisión sigue siendo esta. Si el turno se cerró mientras tanto, el resultado se descarta (`TURN_CLOSED`).
   Solo una revisión exitosa y no `flagged` consume intento (máx. `MAX_REVIEW_ATTEMPTS`). Un borrador `flagged` se rechaza. Si la IA no está disponible, el borrador se guarda sin revisión.
3. **Confirmar** (`confirmPanel`). Cierra la viñeta con el último borrador. Recién ahí los `newCharacters` de ese borrador entran al elenco (los de borradores anteriores se descartan). Se emite `panelConfirmed` y se abre el turno siguiente, o se pasa a PROCESSING si era la última.
4. **Timeout** (`close-turn`). Si hay borradores, confirma el último (`confirmedBy: 'timeout'`, con sus personajes nuevos). Si no hay ninguno, la viñeta queda con `(The author ran out of time.)` y puntaje 0.

Validación del borrador: el DTO valida forma y largos (`MAX_CHARS_PER_PANEL`, `MAX_CHARS_PER_SCENE`, fichas). El servicio valida lo que depende del estado: `MIN_WORDS_PER_PANEL`, que los `characterIds` existan en el elenco, como máximo `MAX_NEW_CHARACTERS_PER_PANEL` nuevos y `MAX_CHARACTERS_PER_PANEL` en total por viñeta (puede no haber ninguno), que el elenco no pase de `MAX_CHARACTERS_PER_STORY` y que los nombres nuevos no se repitan (sin distinguir mayúsculas).

Jugadores que se van durante PLAYING:

- **Desconexión**: el turno sigue corriendo. Al volver, el jugador recibe `gameState`.
- **Abandono** (`leaveGame`): si era el autor del turno, la viñeta se reasigna de inmediato al siguiente jugador conectado (turno nuevo, con su tiempo completo). Si quedan menos de 2 jugadores sin abandonar (los desconectados cuentan), la partida pasa a PROCESSING con las viñetas confirmadas; si no había ninguna, se abandona.

## Eventos

Autenticación: token de Cognito en `handshake.auth.token` (`WsAuthService.authenticateSocket`). Cada socket entra además a su sala personal `user:{userId}`. Con ella el servidor le habla a un usuario, o saca de una sala a todos sus sockets, en cualquier instancia (`KICKED`, `leaveGame`, `panelReviewResult`).

La partida actual de cada usuario no se guarda en el socket: el gateway la lee de Redis (`user:{userId}:story`) en cada evento.

Los cambios que dispara el servicio (incluidos los timers, que corren en cualquier instancia) salen como eventos internos (`STORY_EVENTS`). El gateway los escucha y los difunde a la sala.

Los errores van por el ack si el cliente lo envió; si no, por `storyError`: `{ ok: false, status, message, code }`.

| Evento              | Dirección           | Payload / notas                                                                          |
| ------------------- | ------------------- | ---------------------------------------------------------------------------------------- |
| `createStoryGame`   | cliente → servidor  | Sin payload. Ack: `LobbyView`.                                                           |
| `joinStoryGame`     | cliente → servidor  | `{ gameId }`. Solo en LOBBY; si ya era jugador, reconecta sin cambiar el orden.          |
| `updateConfig`      | cliente → servidor  | Anfitrión, LOBBY. Parcial: `{ panelsCount?, turnDurationSec?, level?, language? }`.      |
| `kickPlayer`        | cliente → servidor  | Anfitrión, LOBBY. `{ userId }`. El expulsado recibe `storyError` con `code: 'KICKED'`.   |
| `startStory`        | cliente → servidor  | Anfitrión. LOBBY → PLAYING y abre el primer turno.                                       |
| `submitPanelDraft`  | cliente → servidor  | Autor. `{ panelOrder, text, scene, characterIds?, newCharacters? }`. Ack: `PanelReviewResultView`. |
| `confirmPanel`      | cliente → servidor  | Autor. `{ panelOrder }`.                                                                 |
| `getGameState`      | cliente → servidor  | Ack: `GameStateView` (estado completo para ese jugador).                                 |
| `leaveGame`         | cliente → servidor  | Sin payload.                                                                             |
| `lobbyUpdated`      | servidor → sala     | `{ gameId, status, hostId, config, players: [{ userId, username, connected, left }] }`   |
| `turnStarted`       | servidor → sala     | `{ panelOrder, authorId, endsAt, storySoFar, cast }`                                     |
| `panelReviewResult` | servidor → autor    | `{ panelOrder, flagged, reviewAvailable, corrections, characterCorrections, attemptsLeft, message? }`. Nunca el texto corregido. |
| `panelConfirmed`    | servidor → sala     | `{ order, authorId, finalText, scene, characterIds, newCharacters, score, confirmedBy }` |
| `gameState`         | servidor → jugador  | `GameStateView`, al reconectarse.                                                        |
| `storyError`        | servidor → emisor   | `{ ok: false, status, message, code }`                                                   |

`panelOrder` va en `submitPanelDraft` y `confirmPanel` para que un mensaje que llega tarde (por ejemplo, después del timeout) no se aplique al turno siguiente: si no es el turno en curso, se responde `TURN_CLOSED`.

`GameStateView`: `{ lobby, turn: { panelOrder, authorId, endsAt } | null, storySoFar, cast, myTurn }`. `myTurn` es `null` salvo para el autor del turno en curso: `{ attempts, attemptsLeft, reviewing, drafts }`, con sus borradores y correcciones, sin el texto corregido.

Códigos de error: `VALIDATION_ERROR`, `USER_NOT_FOUND`, `GAME_NOT_FOUND`, `NOT_IN_GAME`, `ALREADY_IN_GAME`, `NOT_A_PLAYER`, `NOT_HOST`, `INVALID_STATE`, `GAME_FULL`, `NOT_ENOUGH_PLAYERS`, `NOT_ENOUGH_PANELS`, `CANNOT_KICK_SELF`, `KICKED`, `NOT_YOUR_TURN`, `TURN_CLOSED`, `TURN_EXPIRED`, `REVIEW_IN_PROGRESS`, `NO_ATTEMPTS_LEFT`, `NO_DRAFT`, `INVALID_DRAFT`, `UNKNOWN_CHARACTER`, `TOO_MANY_CHARACTERS`, `DUPLICATE_CHARACTER_NAME`.

## Reglas del lobby y la conexión

- Configuración por defecto: 6 viñetas, 90 s por turno, nivel A2, `en-US`. Rangos en `story-game.config.ts`.
- 2 a 6 jugadores. `startStory` exige al menos 2 jugadores conectados y `panelsCount >= cantidad de jugadores` (todos escriben al menos una viñeta; los desconectados también cuentan).
- Un usuario no puede estar en dos partidas activas a la vez (`ALREADY_IN_GAME`).
- Desconexión: el jugador queda `connected: false` y vuelve al reconectarse (a cualquier instancia).
- Si el anfitrión se desconecta o sale, el anfitrión pasa al siguiente jugador conectado en orden (circular). No se devuelve al reconectarse. Si no había nadie conectado, lo recibe el primero que vuelve.
- Salir en LOBBY quita al jugador. Salir después lo marca `left: true` y lo deja en la lista, porque el orden define los turnos.
- LOBBY o PLAYING sin nadie conectado: se programa `abandon-idle` a 60 s; si alguien vuelve o se une, se invalida. El margen evita que un redeploy, que corta todos los sockets a la vez, mate las partidas en curso.

## Pruebas

- `story-game.service.spec.ts`: lobby, anfitrión, abandono y reconexión.
- `story-game.turns.spec.ts`: turnos, borradores, personajes, confirmación, timeout (incluido el cierre exactamente una vez, con y sin lock), reasignación y fin anticipado.
- `test/story-game/story-harness.ts`: Redis en memoria (emula el script Lua con guarda), reloj controlado y dependencias falsas, compartido por los dos specs anteriores.
- `story-state.repository.spec.ts`: formato de las claves y de los scripts, con el cliente Redis mockeado. Incluye un bloque contra un Redis real (scripts Lua y guarda) que se salta si no hay `REDIS_TEST_URL`.
- `queue/story-timeout.queue.spec.ts`: id fijo de la tarea, delay y cancelación.
- `story-game.gateway.spec.ts`: salas personales, partida leída de Redis, `KICKED`, resultado de revisión solo al autor y eventos de turno.
- `dto/story-dtos.spec.ts`: rangos de configuración y payloads a través del pipe del gateway.
