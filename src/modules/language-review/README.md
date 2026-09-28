# LanguageReviewModule: revisión de inglés con IA

Revisa el inglés de los borradores del modo Historieta (texto de la viñeta y fichas de personajes nuevos, en **una sola** llamada) con **Amazon Nova 2 Lite** en Bedrock, usando la **Converse API** (`@aws-sdk/client-bedrock-runtime`, `ConverseCommand`).

## Piezas

| Archivo                                | Rol                                                                                        |
| -------------------------------------- | ------------------------------------------------------------------------------------------ |
| `language-reviewer.ts`                 | `LanguageReviewer`: clase abstracta y token de inyección. `NoErrorsLanguageReviewer` para tests. |
| `language-review.service.ts`           | `LanguageReviewService`: implementación con Bedrock (la que usa la app).                  |
| `review-response.parser.ts`            | Valida la respuesta del modelo contra el esquema de `LanguageReview`.                      |
| `prompts/review-system-prompt.v1.ts`   | Prompt de sistema, versionado.                                                             |
| `language-review.config.ts`            | `REVIEW_TIMEOUT_MS` (8 s), compartido con los turnos del juego.                            |

## Comportamiento

- `temperature: 0`, para que la revisión sea lo más consistente posible.
- **Presupuesto total de 8 s** (`REVIEW_TIMEOUT_MS`), incluido **un reintento** si la llamada falla o la respuesta no es JSON válido o no respeta el esquema. El SDK se crea con `maxAttempts: 1` para que sus reintentos no se sumen.
- **Nunca lanza.** Si falla, tarda o la respuesta sigue siendo inválida tras el reintento, `review` devuelve `null` y el juego sigue sin revisión: el borrador se guarda, no consume intento y la viñeta puntúa 60 fijos si se confirma así. **La IA nunca bloquea la partida.**
- Sin `BEDROCK_REVIEW_MODEL_ID`, la revisión queda desactivada (se loguea un error al arrancar) y todas las revisiones devuelven `null`.

Validación de la respuesta (`parseReviewResponse`):

- Estructura inválida (no es JSON, faltan campos, tipos o valores fuera del esquema) → se reintenta.
- Se descartan las correcciones cuyo `original` no está textualmente en el texto del jugador, o que no cambian nada. El puntaje depende de la cantidad de correcciones, y una inventada castigaría al jugador.
- Se descartan las correcciones de fichas que apuntan a un personaje o fragmento inexistente.
- Si no queda ninguna corrección, `correctedText` es el texto original: el modelo no puede reescribir un texto sin errores.

Qué se hace con el resultado (en `story-game`):

- `panelReviewResult` al autor: `corrections`, `characterCorrections`, `attemptsLeft`, `flagged`. **Nunca `correctedText`** mientras la viñeta está abierta.
- `flagged: true`: el borrador se rechaza sin consumir intento.
- Al confirmar: `finalText` = `correctedText` de la última revisión (o el original si no hubo revisión). Las fichas nuevas entran al elenco con las `characterCorrections` aplicadas, salvo el nombre. Polly narra `finalText` (Fase 4).
- El puntaje lo calcula el servidor con la cantidad de correcciones (`calculatePanelScore`); nunca con un puntaje del modelo.

## Prompt versionado

El prompt está en `prompts/review-system-prompt.v1.ts` (`REVIEW_PROMPT_VERSION = 'v1'`). No se edita una versión publicada: para cambiarlo, se crea `v2` y se apunta el servicio a ella. La versión aparece en los logs de cada revisión.

## Configuración

| Variable                  | Descripción                                                                                                   |
| ------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `BEDROCK_REVIEW_MODEL_ID` | Model ID o inference profile de Nova 2 Lite, tal como lo muestra el catálogo de Bedrock en la región (ej. `us.amazon.nova-2-lite-v1:0`). Tiene que ser un inference profile: con el model ID base (`amazon.nova-2-lite-v1:0`) Bedrock responde "on-demand throughput isn't supported". No está en el código. |
| `BEDROCK_REGION`          | Región de Bedrock. Vacía = `AWS_REGION`.                                                                      |

Credenciales: la cadena estándar del SDK de AWS (variables `AWS_ACCESS_KEY_ID`/`AWS_SECRET_ACCESS_KEY`, rol de la instancia o de la tarea, etc.). El código no crea ni asume credenciales.

## Permisos IAM

- `bedrock:InvokeModel` sobre el modelo de Nova 2 Lite, o sobre el inference profile si `BEDROCK_REVIEW_MODEL_ID` es un profile. Con un inference profile entre regiones, el permiso tiene que cubrir también el modelo base en las regiones a las que el profile enruta.
- El modelo tiene que estar habilitado en la cuenta (Bedrock → Model access).

## Pruebas

- `language-review.service.spec.ts`: Bedrock mockeado. Respuesta válida, parámetros de la llamada, JSON inválido con reintento, fallo, timeout (también con el reintento dentro del presupuesto) y sin model ID.
- `review-response.parser.spec.ts`: esquema y filtros de la respuesta.
