# StoryMediaModule: audio e imágenes del modo Historieta (Fase 4b)

Genera la media de cada viñeta de una historieta terminada: la narración con **Amazon Polly** (voz neural, con las marcas de tiempo de cada palabra) y la imagen con **Amazon Nova Canvas** (Bedrock). Sube los archivos a S3 (bucket privado); las URLs se firman al enviarlas (`StoryUrlSigner`, en `story-game`).

No sabe nada de la partida: lo usa `StoryMediaProcessor` (cola `story-media`, en `story-game/queue/`), que le pasa el resultado a `StoryGameService.onPanelMedia`. El flujo completo (cuándo se pide, REVIEW, FINISHED y el plazo) está en el README de `story-game`, sección "Fin de la partida y media".

## Archivos

| Archivo                        | Rol                                                                                       |
| ------------------------------ | ----------------------------------------------------------------------------------------- |
| `story-media.service.ts`       | `generatePanel`: narra y dibuja en paralelo y sube los dos archivos. Nunca lanza.         |
| `speech-synthesizer.ts`        | `SpeechSynthesizer`: clase abstracta y token de inyección (+ `SilentSpeechSynthesizer`).  |
| `polly-speech.service.ts`      | Implementación con Polly: audio mp3 y speech marks (`word`) del mismo texto.              |
| `speech-marks.parser.ts`       | Speech marks de Polly (una línea JSON por marca) → offsets en caracteres del texto.       |
| `image-generator.ts`           | `ImageGenerator`: clase abstracta y token (+ `NoImageGenerator`).                         |
| `nova-canvas-image.service.ts` | Implementación con Nova Canvas (`InvokeModel`, `TEXT_IMAGE`).                             |
| `panel-image-prompt.ts`        | Prompt de la imagen (estilo fijo + escenario + fichas + acción) y semilla por historieta. |
| `story-media.config.ts`        | Timeouts, tamaño de imagen y keys de S3.                                                  |

## Resultado de una viñeta

| `status` | Cuándo                                                   |
| -------- | -------------------------------------------------------- |
| `ready`  | El audio se generó y se subió. La imagen es opcional.    |
| `failed` | No hay audio (Polly o S3 fallaron). Se puede leer igual. |

Keys de S3: `story/{storyId}/panel-{order}.mp3` y `.png`.

- **Narración**: se narra `finalText` (el texto corregido) con la voz `POLLY_VOICE_ID` y el idioma de la partida (`config.language`). Polly da los offsets de las speech marks en **bytes UTF-8**; `parseSpeechMarks` los pasa a índices del string (con tildes o emojis no coinciden), que es lo que usa el cliente para resaltar la palabra que se está leyendo.
- **Imagen**: el prompt repite el estilo y las fichas de los personajes en todas las viñetas, y la semilla (`seedForStory`) es la misma para toda la historieta, para que parezcan una sola. El prompt negativo evita texto, globos y contenido no apto. Si el filtro de contenido de Bedrock bloquea la imagen, la viñeta queda sin imagen.
- Timeouts: `SPEECH_TIMEOUT_MS` (15 s) y `IMAGE_TIMEOUT_MS` (45 s). El plazo de toda la historieta (`MEDIA_DEADLINE_MS`, 3 min) está en `story-game`.

## Configuración

| Variable                 | Qué es                                                                                     |
| ------------------------ | ------------------------------------------------------------------------------------------ |
| `POLLY_VOICE_ID`         | Voz neural de Polly (inglés). Por defecto `Joanna`.                                        |
| `POLLY_REGION`           | Región de Polly. Vacío = `AWS_REGION`.                                                     |
| `BEDROCK_IMAGE_MODEL_ID` | Model ID de Nova Canvas (ej. `amazon.nova-canvas-v1:0`). Vacío = historietas sin imágenes. |
| `BEDROCK_REGION`         | La misma región que la revisión de inglés. Vacío = `AWS_REGION`.                           |

Credenciales: la cadena estándar del SDK de AWS, como la revisión de inglés.

Permisos IAM necesarios:

- `polly:SynthesizeSpeech`.
- `bedrock:InvokeModel` sobre `arn:aws:bedrock:{region}::foundation-model/amazon.nova-canvas-v1:0` (solo si hay `BEDROCK_IMAGE_MODEL_ID`), y el modelo habilitado en "Model access" de Bedrock.
- `s3:PutObject` sobre `story/*` del bucket (lectura: `s3:GetObject`, ya necesario para las URLs firmadas).

## Pruebas

- `story-media.service.spec.ts`: keys de S3, `ready` sin imagen, `failed` sin audio y error de S3.
- `polly-speech.service.spec.ts`: las dos llamadas a Polly (voz neural, mp3 y speech marks) y el `null` si falla.
- `speech-marks.parser.spec.ts`: marcas `word`, offsets con tildes y líneas inválidas.
- `nova-canvas-image.service.spec.ts`: request de `TEXT_IMAGE` con la semilla, imagen bloqueada y sin modelo configurado.
- `panel-image-prompt.spec.ts`: contenido del prompt, límite de 1024 caracteres y semilla estable.
