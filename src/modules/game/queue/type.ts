export type GameJobKind = 'publish-question' | 'close-question';

/**
 * Paso programado del game loop. `seq` es la fase del match en la que se
 * programó: si al correr el match ya avanzó, el job se descarta. `dueAt` es la
 * hora planeada (epoch ms, servidor) — la línea de tiempo se ancla ahí y no en
 * cuándo corrió realmente el job.
 */
export interface GameJob {
  roomId: string;
  seq: number;
  kind: GameJobKind;
  dueAt: number;
}
