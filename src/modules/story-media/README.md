# StoryMediaModule: audio e imágenes del modo Historieta

Genera la media de cada viñeta de una historieta terminada: la narración con **Amazon Polly** (voz neural, con las marcas de tiempo de cada palabra) y la imagen con el proveedor que indique `IMAGE_PROVIDER` (hoy **Cloudflare Workers AI**, o ninguno). Sube los archivos a S3 (bucket privado); las URLs se firman al enviarlas (`StoryUrlSigner`, en `story-game`), igual para el audio y la imagen.

No sabe nada de la partida: lo usa `StoryMediaProcessor` (cola `story-media`, en `story-game/queue/`), que le pasa el resultado a `StoryGameService.onPanelMedia`. El flujo completo (cuándo se pide, REVIEW, FINISHED y el plazo) está en el README de `story-game`, sección "Fin de la partida y media".

## Archivos

| Archivo                         | Rol                                                                                                          |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `story-media.service.ts`        | `generatePanel`: narra y dibuja en paralelo (la imagen con reintentos) y sube los dos archivos. Nunca lanza. |
| `speech-synthesizer.ts`         | `SpeechSynthesizer`: clase abstracta y token de inyección (+ `SilentSpeechSynthesizer`).                     |
| `polly-speech.service.ts`       | Implementación con Polly: audio mp3 y speech marks (`word`) del mismo texto.                                 |
| `speech-marks.parser.ts`        | Speech marks de Polly (una línea JSON por marca) → offsets en caracteres del texto.                          |
| `image-generator.ts`            | `ImageGenerator`: clase abstracta y token de inyección (+ `NullImageGenerator`).                             |
| `image-generator.factory.ts`    | `createImageGenerator`: elige la implementación según `IMAGE_PROVIDER` y valida sus variables.               |
| `cloudflare-image.generator.ts` | Implementación con Cloudflare Workers AI (API REST, FLUX.1 schnell por defecto).                             |
| `panel-image-prompt.ts`         | Prompt de la imagen (estilo fijo + escenario + fichas + acción) y semilla por partida.                       |
| `story-media.config.ts`         | Timeouts, reintentos, modelo por defecto y keys de S3.                                                       |

## Resultado de una viñeta

| Campo         | Valores                                                                                                                                   |
| ------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `status`      | `ready`: el audio se generó y se subió. `failed`: no hay audio (Polly o S3 fallaron); la viñeta se puede leer igual.                      |
| `imageStatus` | `ready`: dibujada y subida. `failed`: el proveedor falló en todos los intentos, o no se pudo subir. `none`: no hay proveedor de imágenes. |

Keys de S3: `story/{storyId}/panel-{order}.mp3` y `.jpg` o `.png` según el tipo de la imagen.

- **Narración**: se narra `finalText` (el texto corregido) con la voz `POLLY_VOICE_ID` y el idioma de la partida (`config.language`). Polly da los offsets de las speech marks en **bytes UTF-8**; `parseSpeechMarks` los pasa a índices del string (con tildes o emojis no coinciden), que es lo que usa el cliente para resaltar la palabra que se está leyendo.
- **Imagen**: el prompt repite el estilo y las fichas de los personajes en todas las viñetas, y la semilla (`seedForGame`, derivada del `gameId`) es la misma para toda la historieta, para que parezcan una sola.
- **Reintentos de la imagen**: si el proveedor lanza (error HTTP, respuesta sin imagen o timeout), `StoryMediaService` reintenta tras esperar `IMAGE_RETRY_DELAYS_MS` (1 s y 2 s: 3 intentos en total). Si fallan todos, `imageStatus: 'failed'` y el review sigue con el audio. El audio se genera en paralelo y no se reintenta.
- Timeouts: `SPEECH_TIMEOUT_MS` (15 s) y `IMAGE_TIMEOUT_MS` (30 s por intento). El plazo de toda la historieta (`MEDIA_DEADLINE_MS`, 3 min) está en `story-game`: lo que siga pendiente al vencer queda `failed` (audio e imagen).

## Configuración

| Variable         | Qué es                                                                                        |
| ---------------- | --------------------------------------------------------------------------------------------- |
| `POLLY_VOICE_ID` | Voz neural de Polly (inglés). Por defecto `Joanna`.                                           |
| `POLLY_REGION`   | Región de Polly. Vacío = `AWS_REGION`.                                                        |
| `IMAGE_PROVIDER` | `none` (por defecto: historietas sin imágenes) o `cloudflare`. Otro valor: la app no arranca. |
| `CF_ACCOUNT_ID`  | Id de la cuenta de Cloudflare. Obligatoria con `cloudflare`.                                  |
| `CF_API_TOKEN`   | Token de la API con permiso de Workers AI. Obligatoria con `cloudflare`.                      |
| `CF_IMAGE_MODEL` | Modelo de Workers AI. Por defecto `@cf/black-forest-labs/flux-1-schnell`.                     |

Con `IMAGE_PROVIDER=cloudflare` y sin `CF_ACCOUNT_ID` o `CF_API_TOKEN`, la app no arranca y el error dice qué variable falta.

### Token de Cloudflare (solo Workers AI)

1. En el dashboard de Cloudflare, **My Profile → API Tokens → Create Token → Create Custom Token** (o, desde **AI → Workers AI → Use REST API → Create a Workers AI API Token**, que viene con estos permisos).
2. Permisos: **Account → Workers AI → Read** y **Account → Workers AI → Edit**. Nada más (sin permisos de zona, DNS ni Workers).
3. Account Resources: **Include → la cuenta** del proyecto (no "All accounts").
4. Opcional: restringir por IP (Client IP Address Filtering) a las IPs de salida del servidor, y ponerle fecha de vencimiento.
5. Copiar el token en `CF_API_TOKEN`. El id de la cuenta (`CF_ACCOUNT_ID`) está en la página de Workers AI o en la barra lateral de la cuenta.

La documentación de Cloudflare pide los dos permisos (Read y Edit) para ejecutar modelos por REST.

### Supuestos sobre la API de Workers AI

Revisados contra la documentación oficial (página del modelo `flux-1-schnell` y "Get started → REST API") en septiembre de 2026:

- **Petición**: `POST https://api.cloudflare.com/client/v4/accounts/{CF_ACCOUNT_ID}/ai/run/{CF_IMAGE_MODEL}` con `Authorization: Bearer {CF_API_TOKEN}` y un JSON `{ prompt, seed, steps }`.
  - `prompt`: 1 a 2048 caracteres (el nuestro se recorta a `IMAGE_PROMPT_MAX_CHARS` = 1024).
  - `steps`: por defecto 4, máximo 8. Se manda 4 (`CF_IMAGE_STEPS`).
  - `seed`: entero. La documentación no da el rango; `seedForGame` devuelve 0 a 858993459.
  - **Tamaño**: FLUX.1 schnell no documenta `width`/`height`, así que no se mandan y se usa el tamaño por defecto del modelo (cuadrado). Antes, con Nova Canvas, era 1024×768.
  - **Sin prompt negativo**: el modelo no lo admite. Por eso se quitó `PANEL_NEGATIVE_PROMPT`; el prompt ya no le dice que evite texto o globos.
- **Respuesta**: el sobre estándar de la API de Cloudflare, `{ result, success, errors, messages }`; para este modelo `result.image` es la imagen en **base64**. Ejemplos oficiales la tratan como **JPEG**, pero la página no lo fija: el tipo se detecta por los primeros bytes (JPEG o PNG) y un formato desconocido cuenta como error.
- **Errores**: HTTP no 2xx, o `success: false`, se consideran fallo; el mensaje se arma con `errors[].message`. No se distinguen errores reintentables (ej. 429) de permanentes (ej. 401): todos se reintentan igual.
- **Modelo configurable**: con otro `CF_IMAGE_MODEL` se asume la misma entrada (`prompt`, `seed`, `steps`) y la misma salida (`result.image` en base64). No se verificó con otros modelos de imagen de Workers AI; alguno podría responder con la imagen en binario en vez de JSON, y entonces haría falta adaptar el adaptador.

## Pruebas

- `story-media.service.spec.ts`: keys de S3 (`.png`/`.jpg`), semilla por partida, `imageStatus` (`ready`, `none`, `failed`), reintentos con backoff, `failed` sin audio y errores de S3.
- `cloudflare-image.generator.spec.ts` (`fetch` mockeado): petición (URL, token, `prompt`/`seed`/`steps`), imagen JPEG y PNG, error HTTP (con y sin JSON), respuesta sin imagen o con formato desconocido, y timeout de 30 s.
- `image-generator.factory.spec.ts`: `none` por defecto, `cloudflare` con el modelo por defecto o `CF_IMAGE_MODEL`, variables faltantes y proveedor desconocido.
- `polly-speech.service.spec.ts`: las dos llamadas a Polly (voz neural, mp3 y speech marks) y el `null` si falla.
- `speech-marks.parser.spec.ts`: marcas `word`, offsets con tildes y líneas inválidas.
- `panel-image-prompt.spec.ts`: contenido del prompt, límite de 1024 caracteres y semilla estable.
