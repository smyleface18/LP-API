export const STORY_TIMEOUT_QUEUE = 'story-turn-timeout';

/** Programar una tarea diferida (el servicio lo emite con emitAsync). */
export const STORY_SCHEDULE_EVENT = 'story.schedule';
/** Borrar una tarea que quedó obsoleta. Solo limpieza: la tarea igual se descarta sola por `seq`. */
export const STORY_CANCEL_EVENT = 'story.cancel';

export type StoryJobKind = 'abandon-idle' | 'close-turn' | 'media-deadline' | 'review-wait';

/**
 * Paso programado de una partida de Historieta (mismo patrón que GameJob de la
 * trivia). `seq` identifica la fase en la que se programó: si al correr la
 * partida ya cambió, la tarea se descarta. `dueAt` es la hora planeada (epoch
 * ms, servidor).
 *
 * - abandon-idle: seq = `abandonSeq` de la partida.
 * - close-turn: seq = número de viñeta; dueAt = `turnCloseAt` (el fin del
 *   turno, o el respaldo si venció con una revisión en curso). Si la viñeta
 *   se reasignó (su autor abandonó), el turno nuevo tiene otro dueAt.
 * - media-deadline: seq = 0; dueAt = `mediaDeadlineAt`. Las viñetas que sigan
 *   `pending` pasan a `failed` y la partida avanza a REVIEW/FINISHED.
 * - review-wait: seq = 0; dueAt = `reviewAt`. Venció la espera de PROCESSING:
 *   el review empieza aunque falten imágenes o el título.
 */
export interface StoryJob {
  gameId: string;
  kind: StoryJobKind;
  seq: number;
  dueAt: number;
}

/** Id determinístico: deduplica reprogramaciones y permite borrar la tarea. BullMQ no admite ':'. */
export function storyJobId(job: StoryJob): string {
  return `${job.gameId}__${job.seq}__${job.kind}__${job.dueAt}`;
}

/** Cola de la media de las viñetas: una tarea de audio y una de imagen por viñeta. */
export const STORY_MEDIA_QUEUE = 'story-media';

export type StoryMediaJobName = 'panel-audio' | 'panel-image';

/** Prioridad en BullMQ (menor = antes): los audios salen antes que las imágenes. */
export const STORY_MEDIA_JOB_PRIORITY: Record<StoryMediaJobName, number> = {
  'panel-audio': 1,
  'panel-image': 2,
};

/**
 * Tareas que corren a la vez en cada instancia. Polly tarda ~1 s y una imagen
 * unos segundos: con 2 la primera viñeta sale rápido sin saturar las cuotas.
 */
export const STORY_MEDIA_CONCURRENCY = 2;

export function storyMediaJobId(gameId: string, name: StoryMediaJobName, order: number): string {
  const kind = name === 'panel-audio' ? 'audio' : 'image';
  return `${gameId}__${kind}__${order}`;
}
