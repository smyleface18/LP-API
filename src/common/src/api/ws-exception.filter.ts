import { ArgumentsHost, Catch, HttpException, Logger } from '@nestjs/common';
import { BaseWsExceptionFilter, WsException } from '@nestjs/websockets';
import { Socket } from 'socket.io';
import { LockTimeoutError } from '../redis/redis-lock.service';
import { MatchNotFoundError } from '@/modules/game/match/domain/exceptions/match-not-found.error';
import { QuestionNotFoundError } from '@/modules/game/match/domain/exceptions/question-not-found.error';

interface WsErrorPayload {
  ok: false;
  status: number;
  message: string;
}

/**
 * Errores de los handlers del gateway, en el formato que la app entiende:
 * - Si el evento vino con ack (ej. createGame/joinGame), se responde por el
 *   ack con { ok: false, message }: sin esto el cliente queda esperando para
 *   siempre.
 * - Si no, se emite el evento 'error' (que la app muestra en el banner).
 * El filtro por defecto de Nest emite 'exception' (que la app no escucha) y
 * convierte cualquier HttpException en "Internal server error".
 * Los errores desconocidos se loguean y al cliente le llega un mensaje genérico.
 */
@Catch()
export class WsHttpExceptionFilter extends BaseWsExceptionFilter {
  private readonly logger = new Logger(WsHttpExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost) {
    const client = host.switchToWs().getClient<Socket>();
    const payload = this.toPayload(exception);

    // Nest pasa el ack como último argumento del handler cuando el cliente lo envía.
    const ack = host.getArgs().find((arg, index) => index > 1 && typeof arg === 'function') as
      | ((response: WsErrorPayload) => void)
      | undefined;

    if (ack) {
      ack(payload);
    } else {
      client.emit('error', payload);
    }
  }

  private toPayload(exception: unknown): WsErrorPayload {
    if (exception instanceof HttpException) {
      const response = exception.getResponse() as string | { message?: string | string[] };
      const raw = typeof response === 'string' ? response : (response.message ?? exception.message);
      return {
        ok: false,
        status: exception.getStatus(),
        message: Array.isArray(raw) ? raw.join('\n') : raw,
      };
    }
    if (exception instanceof WsException) {
      const error = exception.getError();
      return { ok: false, status: 400, message: typeof error === 'string' ? error : 'Bad request' };
    }
    if (exception instanceof MatchNotFoundError) {
      return { ok: false, status: 404, message: 'Match not found' };
    }
    if (exception instanceof QuestionNotFoundError) {
      return { ok: false, status: 404, message: 'Question not found' };
    }
    if (exception instanceof LockTimeoutError) {
      return { ok: false, status: 503, message: 'The room is busy, try again' };
    }

    this.logger.error(
      exception instanceof Error ? (exception.stack ?? exception.message) : exception,
    );
    return { ok: false, status: 500, message: 'Internal server error' };
  }
}
