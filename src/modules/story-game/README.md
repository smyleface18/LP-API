# StoryGameModule: modo Historieta (`/story`)

Uno o varios jugadores escriben una historieta en inglés, una viñeta por turno (si juega uno solo, escribe todas). Los personajes se crean durante los turnos. Este módulo tiene el namespace de Socket.IO `/story`, la máquina de estados, el estado compartido en Redis y las tareas diferidas en BullMQ.

Estado actual: **Fase 4c** (lobby, turnos y personajes, revisión de inglés con IA, puntuación, reacciones, review con audio narrado e imágenes, e historial en Postgres). La media la genera `src/modules/story-media/` y el historial vive en `src/modules/story-history/`; ver sus README.

## Archivos

| Archivo                     | Rol                                                                                   |
| --------------------------- | ------------------------------------------------------------------------------------- |
| `story-game.gateway.ts`     | Namespace `/story`: autentica, traduce eventos y difunde. Sin reglas.                  |
| `story-game.service.ts`     | Máquina de estados y orquestación (lock, guardado, timers, eventos).                  |
| `domain/story-turns.ts`     | Reglas de los turnos como funciones puras: autor, apertura, cierre, validación.       |
| `domain/story-review.ts`    | Manifiesto del review y marcador (`scoreboard`/`ranking`), como funciones puras.      |
| `story-state.repository.ts` | Lectura/escritura en Redis (hashes, scripts Lua con guarda, referencia usuario → partida). |
| `story-url-signer.service.ts` | Firma las URLs de avatares y media (keys de S3) al enviar las vistas, con caché.   |
| `story-game.config.ts`      | Todos los números del modo (jugadores, rangos, límites de texto y personajes).        |
| `domain/`                   | Tipos, errores (`StoryError` con `code`), eventos internos y vistas para el cliente.  |
| `dto/`                      | DTOs de los eventos con `class-validator`.                                            |
| `story-validation.pipe.ts`  | `ValidationPipe` del gateway; los errores salen como `VALIDATION_ERROR`.               |
| `queue/`                    | Colas BullMQ: `story-turn-timeout` (tareas diferidas, patrón `dueAt + seq`) y `story-media` (una tarea por viñeta). |

La revisión de inglés la hace `LanguageReviewer` (`src/modules/language-review/`), una clase abstracta que sirve de token de inyección; la implementación es `LanguageReviewService` (Nova 2 Lite en Bedrock). Ver su README.

## Estados

```text
LOBBY → PLAYING → PROCESSING → REVIEW → FINISHED
LOBBY/PLAYING → ABANDONED (nadie conectado durante 60 s, o ya nadie puede volver)
```

PROCESSING y REVIEW nunca se abandonan: la historieta se termina de generar y se guarda en el historial aunque todos se hayan ido. PROCESSING dura hasta que la primera viñeta tiene su media, y REVIEW hasta que la tienen todas (ver Fin de la partida).

Solo el servidor cambia el estado. Un evento que no corresponde al estado actual devuelve `INVALID_STATE`.

## Estado en Redis

TTL: `MATCH_TTL` (se renueva en cada escritura). Una partida FINISHED usa `FINISHED_STORY_TTL_MS` (24 h), también en las escrituras posteriores (reacciones), para servir el review en vivo por socket; después solo queda en Postgres (`GET /story/history/:storyId`). Todas las claves de una partida comparten el hash tag `{gameId}`.

```text
story:{gameId}              hash: status, hostId, config (json), players (json, en orden de entrada, con avatarKey),
                            currentPanel, turnEndsAt, turnCloseAt, abandonAt, abandonSeq, createdAt,
                            storyId, mediaDeadlineAt
story:{gameId}:characters   hash: characterId → { id, name, kind, description, createdBy, introducedInPanel }
story:{gameId}:panels       hash: order → viñeta (PanelState, json, con `media`: status y keys de S3)
story:{gameId}:lock         lock de la partida (RedisLockService)
user:{userId}:story         partida activa del usuario (reconexión, una partida a la vez)
```

Cada cambio pasa por `StoryGameService.mutate`: toma el lock de la partida, lee, valida y modifica, y guarda con `StoryStateRepository.save`. Después sincroniza las tareas diferidas y publica los eventos internos. `save` es un script Lua que:

1. escribe solo si el lock sigue siendo nuestro (fencing, como `MatchStore.save`);
2. si la escritura lleva **guarda**, verifica en el mismo script que la viñeta siga `open` (y, si se indica, que su revisión en curso sea el mismo `attemptId`). Si no se cumple, no escribe nada.

La guarda es lo que hace que un turno se cierre **una sola vez**: confirmar y el timeout usan el mismo cierre con guarda, así que aunque llegaran juntos sin el lock, Redis rechaza el segundo.

El elenco solo crece: los personajes son inmutables una vez agregados, porque otras viñetas dependen de ellos. Su id es `ch-{viñeta}-{índice}`.

## Avatares y media (URLs firmadas)

Cada jugador guarda en Redis la **key** de S3 de su avatar (`avatarKey`, tomada del `User` al crear, unirse o reconectarse con `joinStoryGame`), y cada viñeta las keys de su audio e imagen (`media.audioKey`, `media.imageKey`); nunca las URLs: las URLs firmadas vencen y una partida terminada vive 24 h. `StoryUrlSigner` firma las keys al enviar cada vista: `avatarsFor(players)` devuelve `userId → URL` y `mediaFor(panels)` `order → { audioUrl, imageUrl }`. Una key que no se puede firmar sale `null`, lo que nunca frena la partida.

Cada URL dura `SIGNED_URL_TTL_SEC` (2 h) y se reutiliza mientras le quede al menos `SIGNED_URL_MIN_REMAINING_MS` (30 min): así el cliente no recarga la imagen o el audio en cada evento. La caché es por instancia. En el review, el cliente puede volver a pedir `getReviewManifest` para URLs nuevas.

Llevan `avatarUrl`: los jugadores de `lobbyUpdated` (y de `gameState.lobby`), `gameState.scoreboard` y el `ranking` del manifiesto.

Como firmar es async, el gateway manda todas las emisiones a salas por una cola (`emitInOrder`): los eventos de una instancia salen en el orden en que el servicio los publicó (ej. `lobbyUpdated` con PLAYING antes de `turnStarted`). Por lo mismo, `storyReviewReady` lleva el estado en el evento interno y el gateway arma el manifiesto.

## Tareas diferidas (cola `story-turn-timeout`)

Mismo patrón que la trivia (`GameTimeoutQueue`): el servicio emite `story.schedule` con `{ gameId, kind, seq, dueAt }`. `StoryTimeoutQueue` crea una tarea con delay y un id fijo, y `StoryTimeoutProcessor` llama al servicio cuando vence. El servicio compara las tareas que corresponden al estado anterior y al nuevo: programa las nuevas y emite `story.cancel` para las que quedaron obsoletas. Borrarlas es solo limpieza: la garantía es que cada tarea se valida al correr.

| `kind`         | `seq`        | Vale si…                                                    | Qué hace                                         |
| -------------- | ------------ | ----------------------------------------------------------- | ------------------------------------------------ |
| `abandon-idle` | `abandonSeq` | LOBBY/PLAYING, mismo `abandonSeq`, nadie conectado          | Pasa a ABANDONED.                                |
| `close-turn`   | viñeta       | PLAYING, `currentPanel = seq`, `turnCloseAt = dueAt`, abierta | Cierra el turno por tiempo (confirma o rellena), o lo difiere si hay una revisión en curso. |
| `media-deadline` | 0          | PROCESSING/REVIEW, `mediaDeadlineAt = dueAt`                | Las viñetas que sigan `pending` quedan `failed` y la partida avanza a REVIEW/FINISHED. |

`turnEndsAt` es el fin del turno que ven los clientes. `turnCloseAt` es cuándo corre `close-turn`: normalmente es igual, salvo cuando el turno vence con una revisión en curso (ver Turnos, punto 4).

Los eventos que dispara un timer llegan a todos los jugadores igual que en la trivia: la tarea corre en una instancia cualquiera, el servicio emite el evento interno, el gateway de esa instancia hace `server.to(gameId).emit(...)` y el `RedisIoAdapter` (main.ts) lo entrega a los sockets de la sala en todas las instancias. `story-game.timers.spec.ts` prueba ese camino de punta a punta hasta `server.to`, y también el de `processingStarted` hasta `storyReviewReady` y FINISHED con el `EventEmitter2` real.

## Turnos

1. **Abrir.** Al entrar a PLAYING, y al cerrar cada turno, se abre la viñeta siguiente: `turnEndsAt = ahora + turnDurationSec`, se programa `close-turn` y se emite `turnStarted`. La viñeta `i` es de `players[i % n]`; si ese jugador abandonó, es del siguiente en orden (conectado; si no hay, el siguiente que no abandonó).
2. **Borrador** (`submitPanelDraft`). Se hace en tres pasos, para no tener el lock tomado mientras se espera a la IA:
   - a) Con lock: valida el turno y el borrador, cuenta el envío (tope `MAX_DRAFTS_PER_TURN` = 5 por turno, consuman o no intento: `DRAFT_LIMIT_REACHED`) y marca la viñeta como "en revisión" con un `attemptId`. Mientras tanto se rechaza otro borrador o confirmar (`REVIEW_IN_PROGRESS`), salvo que la revisión tenga más de `REVIEW_STALE_MS` (= `REVIEW_TIMEOUT_MS` + 4 s): se da por perdida.
   - b) Sin lock: revisa el inglés.
   - c) Con lock y guarda (`attemptId`): guarda el resultado solo si la viñeta sigue abierta y la revisión sigue siendo esta. Si el turno se cerró mientras tanto, el resultado se descarta (`TURN_CLOSED`).
   Solo una revisión exitosa y no `flagged` consume intento (máx. `MAX_REVIEW_ATTEMPTS`). Un borrador `flagged` se rechaza. Si la IA no está disponible, el borrador se guarda sin revisión.
   En a) y c) se emite `authorStatus` a la sala: `reviewing` mientras la IA revisa; después, `correcting` si el autor ya tiene algún borrador guardado, o `writing` si no (ej. el primero vino `flagged`). Al abrir un turno el estado es `writing` (lo implica `turnStarted`). `gameState` lo trae en `turn.authorStatus`, y una revisión perdida (más vieja que `REVIEW_STALE_MS`) no cuenta como `reviewing`.
   Con `config.shareDrafts` (por defecto `true`), cada borrador guardado se envía a la sala **menos el autor** como `panelDraftReviewed`: texto, escenario, personajes, personajes nuevos y correcciones, nunca el texto corregido. Un borrador `flagged` no se comparte. Un borrador sin revisión (IA caída) se comparte con `reviewAvailable: false` y sin correcciones.
3. **Confirmar** (`confirmPanel`). Cierra la viñeta con el último borrador. Recién ahí los `newCharacters` de ese borrador entran al elenco (los de borradores anteriores se descartan). Se emite `panelConfirmed` y se abre el turno siguiente, o se pasa a PROCESSING si era la última.
4. **Timeout** (`close-turn`). Si hay borradores, confirma el último (`confirmedBy: 'timeout'`, con sus personajes nuevos). Si no hay ninguno, la viñeta queda con `(The author ran out of time.)` y puntaje 0.
   Si al vencer hay una revisión en curso, no cierra todavía: marca `closeWhenReviewed`, y cuando se guarda el resultado de esa revisión el turno se cierra con ese borrador (`confirmedBy: 'timeout'`). Como respaldo, `close-turn` se reprograma (misma viñeta) para `inicio de la revisión + REVIEW_TIMEOUT_MS + 2 s`; si corre, cierra con lo que haya. Un borrador enviado después de `endsAt` se rechaza (`TURN_EXPIRED`).

## Reacciones

`reactToPanel` `{ panelOrder, emoji, gameId? }`: un jugador (que no abandonó) reacciona a una viñeta **confirmada**, en PLAYING, PROCESSING, REVIEW o FINISHED. Una reacción por jugador y viñeta: otra la reemplaza y `emoji: null` la quita; repetir la misma no hace nada. Emojis permitidos: `STORY_REACTIONS` (`👏 😂 😮 ❤️ 🔥`). Se guardan en la viñeta (`reactions: userId → emoji`), viajan en `storySoFar` y se difunden como `panelReaction` `{ gameId, order, userId, emoji }`. `gameId` va en el payload porque un socket puede seguir en la sala de una partida ya terminada. Sin `gameId` en el evento se usa la partida activa del usuario.

## Puntuación

`domain/story-score.ts` → `calculatePanelScore(drafts, confirmedBy)`, una función pura. Se calcula en el servidor al cerrar la viñeta, con la cantidad de errores; nunca con un puntaje del modelo. Las constantes están en `story-game.config.ts`.

```text
palabras  = palabras del último texto del jugador
errores   = correcciones de la ÚLTIMA revisión
precisión = round(100 × max(0, 1 − 3 × errores / palabras))
```

| Situación                                               | Puntos                      |
| ------------------------------------------------------- | --------------------------- |
| Precisión                                               | 0–100                       |
| 0 errores en la revisión 1                              | +50                         |
| La revisión 2 tiene menos errores que la 1              | +25                         |
| Confirmada por timeout                                  | La precisión vale la mitad  |
| Sin texto (venció sin borradores)                       | 0                           |
| El último borrador no se pudo revisar (IA no disponible) | 60 fijos                   |

"Revisión n" es el n-ésimo borrador que sí se revisó. El puntaje va en `panelConfirmed` y se suma al autor en Redis (`players[].totalScore` y `players[].panelsWritten`; una viñeta que venció sin texto cuenta como escrita, con 0). El ranking por promedio (`totalScore / panelsWritten`) va en `gameState.scoreboard` y en el manifiesto.

Las fichas de personajes nuevos entran al elenco con las `characterCorrections` de la última revisión aplicadas, salvo el nombre. No suman ni restan puntos.

El texto corregido nunca se envía mientras la viñeta está abierta: ni en `panelReviewResult` ni en `gameState`/`getGameState`. Se ve recién cuando la viñeta se confirma (`finalText` de `panelConfirmed`).

Validación del borrador: el DTO valida forma y largos (`MAX_CHARS_PER_PANEL`, `MAX_CHARS_PER_SCENE`, fichas). El servicio valida lo que depende del estado: `MIN_WORDS_PER_PANEL`, que los `characterIds` existan en el elenco, como máximo `MAX_NEW_CHARACTERS_PER_PANEL` nuevos y `MAX_CHARACTERS_PER_PANEL` en total por viñeta (puede no haber ninguno), que el elenco no pase de `MAX_CHARACTERS_PER_STORY` y que los nombres nuevos no se repitan (sin distinguir mayúsculas).

Jugadores que se van durante PLAYING:

- **Desconexión**: el turno sigue corriendo. Al volver, el jugador recibe `gameState`.
- **Abandono** (`leaveGame`): si era el autor del turno, la viñeta se reasigna de inmediato al siguiente jugador conectado (turno nuevo, con su tiempo completo). Si quedan menos de `STORY_MIN_PLAYERS_TO_CONTINUE` (2) jugadores sin abandonar (los desconectados cuentan), la partida pasa a PROCESSING con las viñetas confirmadas; si no había ninguna, se abandona. Una partida individual termina así cuando su jugador sale.

## Fin de la partida y media (Fase 4b)

Al cerrarse la última viñeta (o al quedar menos de 2 jugadores), la partida pasa a PROCESSING y el servicio emite el evento interno `story.processing-started`. `StoryGameService.onProcessingStarted` (`@OnEvent`) es el **único punto** de la generación:

1. `requestMedia`: asigna el `storyId` (un UUID: es el id del historial en Postgres), marca cada viñeta confirmada como `pending` (o `none` si venció sin texto), fija `mediaDeadlineAt = ahora + MEDIA_DEADLINE_MS` (3 min) y emite `story.media-requested`. Idempotente: si ya hay `storyId`, no hace nada.
2. `StoryMediaQueue` crea una tarea por viñeta en la cola `story-media` (id fijo `{gameId}__media__{order}`, la primera viñeta primero). `StoryMediaProcessor` (concurrencia `STORY_MEDIA_CONCURRENCY` = 2) llama a `StoryMediaService.generatePanel` y le pasa el resultado a `onPanelMedia`.
3. `onPanelMedia` guarda la media de la viñeta solo si sigue `pending` (el primer resultado gana) y emite `story.panel-media-ready` y el avance (`story.processing`).
4. `advanceAfterMedia`, después de cada resultado:
   - PROCESSING → REVIEW (`enterReview`) cuando la **primera** viñeta ya no está pendiente. Emite `lobbyUpdated` y `storyReviewReady` con el manifiesto a la sala, y libera `user:{userId}:story` de todos los jugadores (solo si todavía apunta a esta partida). Desde ahí pueden crear o unirse a otra partida sin `ALREADY_IN_GAME`. Las viñetas que faltan le llegan a la sala por `panelMediaReady`.
   - REVIEW → FINISHED (`finishStory`) cuando **ninguna** está pendiente. TTL de 24 h y evento `story.finished`, con el que `StoryHistoryService` la guarda en Postgres (Fase 4c).
5. Si vence el plazo (`media-deadline`), lo pendiente queda `failed` y la partida avanza igual: una cola caída, una tarea perdida o AWS sin responder nunca dejan una partida en PROCESSING.

Una viñeta es `ready` si tiene audio y `failed` si no. La imagen va aparte, en `media.imageStatus` (`none` sin proveedor de imágenes o sin texto, `pending`, `ready` o `failed` si el proveedor falló en todos los intentos o venció el plazo); sin imagen, la viñeta se lee igual. Sin ninguna viñeta con texto no se pide nada y la partida pasa directo a FINISHED. Las transiciones son idempotentes (solo actúan desde el estado anterior).

Como la partida ya no es la activa del usuario, `getReviewManifest` y `reactToPanel` reciben el `gameId`. `getReviewManifest` funciona en REVIEW y FINISHED para cualquier participante (incluso si salió), y mete al socket en la sala para recibir `panelReaction`. Tras el TTL responde `GAME_NOT_FOUND`.

### Manifiesto (`storyReviewReady`, ack de `getReviewManifest`)

```ts
{
  storyId: string;            // id en Postgres (GET /story/history/:storyId)
  gameId: string;
  characters: {               // elenco, en orden de creación
    id: string; name: string; kind: string; description: string;
    createdBy: string; introducedInPanel: number;
  }[];
  ranking: {                  // por averageScore desc; desempata totalScore y el orden de entrada;
    userId: string;           // los que no escribieron ninguna viñeta van al final
    name: string;
    avatarUrl: string | null; // firmada (ver Avatares)
    panelsWritten: number;
    averageScore: number;     // totalScore / panelsWritten, un decimal; 0 sin viñetas
    totalScore: number;
  }[];
  panels: {                   // viñetas confirmadas, por order
    order: number;
    author: { id: string; name: string };
    originalText: string;     // último texto del jugador; '' si venció sin borradores
    finalText: string;        // corregido (lo que se narra)
    scene: string;
    characterIds: string[];
    corrections: Correction[];          // de la última revisión (las que puntúan)
    score: PanelScore;                  // { accuracy, firstTryBonus, selfCorrectionBonus, timeoutPenalty, total }
    reactions: Record<string, string>;  // userId → emoji
    audioUrl: string | null;            // mp3 firmado; null si no hay audio (todavía o nunca)
    // Una marca por palabra: ms desde el inicio del audio y offsets en caracteres de finalText.
    speechMarks: { time: number; start: number; end: number; value: string }[] | null;
    imageUrl: string | null;            // null hasta que haya un ImageGenerator real
    mediaStatus: 'none' | 'pending' | 'ready' | 'failed'; // none = venció sin texto
    imageStatus: 'none' | 'pending' | 'ready' | 'failed'; // none = sin proveedor de imágenes o sin texto
  }[];
}
```

## Eventos

Autenticación: token de Cognito en `handshake.auth.token` (`WsAuthService.authenticateSocket`). Cada socket entra además a su sala personal `user:{userId}`. Con ella el servidor le habla a un usuario, o saca de una sala a todos sus sockets, en cualquier instancia (`KICKED`, `leaveGame`, `panelReviewResult`).

La partida actual de cada usuario no se guarda en el socket: el gateway la lee de Redis (`user:{userId}:story`) en cada evento.

Los cambios que dispara el servicio (incluidos los timers, que corren en cualquier instancia) salen como eventos internos (`STORY_EVENTS`). El gateway los escucha y los difunde a la sala.

Los errores van por el ack si el cliente lo envió; si no, por `storyError`: `{ ok: false, status, message, code }`.

| Evento              | Dirección           | Payload / notas                                                                          |
| ------------------- | ------------------- | ---------------------------------------------------------------------------------------- |
| `createStoryGame`   | cliente → servidor  | Sin payload. Ack: `LobbyView`.                                                           |
| `joinStoryGame`     | cliente → servidor  | `{ gameId }`. Solo en LOBBY; si ya era jugador, reconecta sin cambiar el orden.          |
| `updateConfig`      | cliente → servidor  | Anfitrión, LOBBY. Parcial: `{ panelsCount?, turnDurationSec?, level?, language?, shareDrafts? }`. |
| `kickPlayer`        | cliente → servidor  | Anfitrión, LOBBY. `{ userId }`. El expulsado recibe `storyError` con `code: 'KICKED'`.   |
| `startStory`        | cliente → servidor  | Anfitrión. LOBBY → PLAYING y abre el primer turno.                                       |
| `submitPanelDraft`  | cliente → servidor  | Autor. `{ panelOrder, text, scene, characterIds?, newCharacters? }`. Ack: `PanelReviewResultView`. |
| `confirmPanel`      | cliente → servidor  | Autor. `{ panelOrder }`.                                                                 |
| `reactToPanel`      | cliente → servidor  | `{ panelOrder, emoji \| null, gameId? }`. Ver Reacciones.                                |
| `getGameState`      | cliente → servidor  | Ack: `GameStateView` (estado completo para ese jugador).                                 |
| `getReviewManifest` | cliente → servidor  | `{ gameId }`. REVIEW o FINISHED, participantes. Ack: manifiesto.                          |
| `leaveGame`         | cliente → servidor  | Sin payload.                                                                             |
| `timeSync`          | cliente → servidor  | Sin payload. Ack: `{ serverTime }` para estimar el offset del reloj (`endsAt` está en hora del servidor). |
| `getStoryRules`     | cliente → servidor  | Sin payload. Ack: `StoryRulesView` (ver Reglas para el cliente).                         |
| `lobbyUpdated`      | servidor → sala     | `{ gameId, status, hostId, config, players: [{ userId, username, avatarUrl, connected, left }] }` |
| `turnStarted`       | servidor → sala     | `{ panelOrder, authorId, endsAt, storySoFar, cast }`                                     |
| `panelReviewResult` | servidor → autor    | `{ panelOrder, flagged, reviewAvailable, corrections, characterCorrections, attemptsLeft, message? }`. Nunca el texto corregido. |
| `authorStatus`      | servidor → sala     | `{ order, status: 'writing' \| 'reviewing' \| 'correcting' }`                           |
| `panelDraftReviewed`| servidor → sala menos el autor | Con `shareDrafts`: `{ order, authorId, text, scene, characterIds, newCharacters, reviewAvailable, corrections, characterCorrections }`. Nunca el texto corregido ni un borrador `flagged`. |
| `panelReaction`     | servidor → sala     | `{ gameId, order, userId, emoji \| null }`                                                |
| `panelConfirmed`    | servidor → sala     | `{ order, authorId, finalText, scene, characterIds, newCharacters, score, confirmedBy }` |
| `storyProcessing`   | servidor → sala     | En PROCESSING: `{ gameId, panelsTotal, panelsDone }` (avance de la media).              |
| `storyReviewReady`  | servidor → sala     | Manifiesto, al entrar a REVIEW (con la media de la primera viñeta).                      |
| `panelMediaReady`   | servidor → sala     | `{ gameId, order, mediaStatus, imageStatus, audioUrl, imageUrl, speechMarks }`: una viñeta terminó su media (URLs firmadas). |
| `gameState`         | servidor → jugador  | `GameStateView`, al reconectarse.                                                        |
| `storyError`        | servidor → emisor   | `{ ok: false, status, message, code }`                                                   |

`panelOrder` va en `submitPanelDraft` y `confirmPanel` para que un mensaje que llega tarde (por ejemplo, después del timeout) no se aplique al turno siguiente: si no es el turno en curso, se responde `TURN_CLOSED`.

`GameStateView`: `{ lobby, turn: { panelOrder, authorId, endsAt, authorStatus } | null, storySoFar, cast, scoreboard, myTurn }`. `scoreboard` tiene el mismo formato y orden que el `ranking` del manifiesto, para reconstruir el marcador al reconectarse. Cada viñeta de `storySoFar` es `{ order, authorId, finalText, scene, characterIds, reactions }`. `myTurn` es `null` salvo para el autor del turno en curso: `{ attempts, attemptsLeft, reviewing, drafts }`, con sus borradores y correcciones, sin el texto corregido.

Códigos de error: `VALIDATION_ERROR`, `USER_NOT_FOUND`, `GAME_NOT_FOUND`, `NOT_IN_GAME`, `ALREADY_IN_GAME`, `NOT_A_PLAYER`, `NOT_HOST`, `INVALID_STATE`, `GAME_FULL`, `NOT_ENOUGH_PLAYERS`, `NOT_ENOUGH_PANELS`, `CANNOT_KICK_SELF`, `KICKED`, `NOT_YOUR_TURN`, `TURN_CLOSED`, `TURN_EXPIRED`, `REVIEW_IN_PROGRESS`, `NO_ATTEMPTS_LEFT`, `DRAFT_LIMIT_REACHED`, `NO_DRAFT`, `INVALID_DRAFT`, `UNKNOWN_CHARACTER`, `TOO_MANY_CHARACTERS`, `DUPLICATE_CHARACTER_NAME`, `PANEL_NOT_CONFIRMED`.

## Reglas para el cliente (`getStoryRules`)

El cliente pide las reglas una vez (no dependen de la partida ni del usuario) y arma con ellas los formularios, en lugar de copiar los números. Salen de `story-game.config.ts` (`STORY_RULES` en `domain/story-game.views.ts`):

```ts
{
  players: { min: 1, max: 6 },
  config: {
    panelsCount: { min: 4, max: 10 },
    turnDurationsSec: [60, 90, 120, 180],
    levels: ['A1', 'A2', 'B1', 'B2'],
    languages: ['en-US'],
    defaults: { panelsCount: 6, turnDurationSec: 90, level: 'A2', language: 'en-US', shareDrafts: true },
  },
  draft: { minWords: 8, maxChars: 320, maxSceneChars: 200, maxReviewAttempts: 2, maxDraftsPerTurn: 5 },
  characters: {
    maxPerStory: 6, maxPerPanel: 3, maxNewPerPanel: 2,
    limits: { name: 30, kind: 30, description: 100 },
  },
  reactions: ['👏', '😂', '😮', '❤️', '🔥'],
}
```

El servidor sigue validando todo; las reglas son para que la interfaz no deje armar algo que se va a rechazar.

## Reglas del lobby y la conexión

- Configuración por defecto: 6 viñetas, 90 s por turno, nivel A2, `en-US`, `shareDrafts: true`. Rangos en `story-game.config.ts`.
- 1 a 6 jugadores (con uno, es una partida individual). `startStory` exige al menos 1 jugador conectado y `panelsCount >= cantidad de jugadores` (todos escriben al menos una viñeta; los desconectados también cuentan).
- Un usuario no puede estar en dos partidas activas a la vez (`ALREADY_IN_GAME`).
- Desconexión: el jugador queda `connected: false` y vuelve al reconectarse (a cualquier instancia).
- Si el anfitrión se desconecta o sale, el anfitrión pasa al siguiente jugador conectado en orden (circular). No se devuelve al reconectarse. Si no había nadie conectado, lo recibe el primero que vuelve.
- Salir en LOBBY quita al jugador. Salir después lo marca `left: true` y lo deja en la lista, porque el orden define los turnos.
- LOBBY o PLAYING sin nadie conectado: se programa `abandon-idle` a 60 s; si alguien vuelve o se une, se invalida. El margen evita que un redeploy, que corta todos los sockets a la vez, mate las partidas en curso.

## Pruebas

- `story-game.service.spec.ts`: lobby, anfitrión, abandono y reconexión.
- `story-game.turns.spec.ts`: turnos, borradores, personajes, confirmación, timeout (incluido el cierre exactamente una vez, con y sin lock, y el cierre diferido por una revisión en curso), reasignación y fin anticipado.
- `domain/story-score.spec.ts`: `calculatePanelScore` (primer intento perfecto, autocorrección, timeout, sin texto, IA caída).
- `story-game.sharing.spec.ts`: `authorStatus`, `panelDraftReviewed` (sin texto corregido, no `flagged`, `shareDrafts: false`) y reacciones.
- `story-game.review.spec.ts`: fin de la partida: última viñeta → `storyReviewReady` → FINISHED, manifiesto, ranking por promedio, jugadores liberados al entrar a REVIEW, TTL de 24 h, `getReviewManifest` y `scoreboard`.
- `story-game.media.spec.ts`: media: `storyId`, viñetas `pending`/`none`, REVIEW con la primera viñeta, FINISHED con la última, resultados tardíos descartados, plazo vencido y partida sin texto.
- `story-game.timers.spec.ts`: una tarea de la cola llega hasta `server.to(gameId).emit` (módulo de Nest real con `EventEmitterModule`), y PROCESSING → REVIEW → FINISHED con un worker de media falso.
- `test/story-game/story-harness.ts`: Redis en memoria (emula el script Lua con guarda), reloj controlado y dependencias falsas, compartido por los dos specs anteriores.
- `story-state.repository.spec.ts`: formato de las claves y de los scripts, con el cliente Redis mockeado. Incluye un bloque contra un Redis real (scripts Lua y guarda) que se salta si no hay `REDIS_TEST_URL`.
- `queue/story-timeout.queue.spec.ts`: id fijo de la tarea, delay y cancelación.
- `queue/story-media.queue.spec.ts`: una tarea por viñeta con id fijo, y el processor que le pasa el resultado al servicio.
- `story-url-signer.service.spec.ts`: firma de avatares y media, reutilización de la URL según el tiempo que le queda y keys que no se pueden firmar.
- `story-game.gateway.spec.ts`: salas personales, partida leída de Redis, `KICKED`, resultado de revisión solo al autor, borradores a la sala menos el autor, reacciones, eventos de turno, avatares firmados (nunca la key), orden de las emisiones con una firma lenta, `storyProcessing`, `panelMediaReady` (media firmada) y `getStoryRules`.
- `dto/story-dtos.spec.ts`: rangos de configuración y payloads a través del pipe del gateway.
