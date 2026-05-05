import { ArgumentsHost, Catch, HttpException } from '@nestjs/common';
import { BaseWsExceptionFilter } from '@nestjs/websockets';
import { Socket } from 'socket.io';

@Catch()
export class WsHttpExceptionFilter extends BaseWsExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost) {
    const client = host.switchToWs().getClient<Socket>();

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const response = exception.getResponse() as
        | string
        | { message?: string | string[]; error?: string };

      const message =
        typeof response === 'string' ? response : (response.message ?? exception.message);
      const error = typeof response === 'string' ? undefined : response.error;

      client.emit('exception', {
        status,
        message,
        error,
      });
      return;
    }

    const error = exception instanceof Error ? exception : new Error('Unknown error');

    client.emit('exception', {
      status: 500,
      message: error.message,
      error: error.name,
    });
  }
}
