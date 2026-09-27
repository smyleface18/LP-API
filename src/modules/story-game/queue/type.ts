export const STORY_TIMEOUT_QUEUE = 'story-turn-timeout';

/** Programar una tarea diferida (el servicio lo emite con emitAsync). */
export const STORY_SCHEDULE_EVENT = 'story.schedule';
/** Borrar una tarea que quedó obsoleta. Solo limpieza: la tarea igual se descarta sola por `seq`. */
export const STORY_CANCEL_EVENT = 'story.cancel';

/** 'close-turn' se agrega en la Fase 2. */
export type StoryJobKind = 'abandon-lobby';

/**
 * Paso programado de una partida de Historieta (mismo patrón que GameJob de la
 * trivia). `seq` identifica la fase en la que se programó: si al correr la
 * partida ya cambió, la tarea se descarta. `dueAt` es la hora planeada (epoch
 * ms, servidor).
 *
 * - abandon-lobby: seq = `abandonSeq` de la partida.
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
