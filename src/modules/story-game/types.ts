import { Socket } from 'socket.io';
import { AuthenticatedSocketData } from '@/common/src/ws-auth/ws-auth.service';

/** La partida actual no se guarda en el socket: sale de Redis (`user:{userId}:story`). */
export interface StorySocket extends Socket {
  data: AuthenticatedSocketData;
}

/** Evento por el que /story informa errores al emisor (sin ack). */
export const STORY_ERROR_EVENT = 'storyError';

/** Sala personal de cada usuario en /story, para hablarle en cualquier instancia. */
export function storyUserRoom(userId: string): string {
  return `user:${userId}`;
}
