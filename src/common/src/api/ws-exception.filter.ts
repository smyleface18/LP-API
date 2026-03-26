import { ArgumentsHost, Catch, HttpException } from '@nestjs/common';
import { BaseWsExceptionFilter } from '@nestjs/websockets';
import { Socket } from 'dgram';

@Catch(HttpException)
export class WsHttpExceptionFilter extends BaseWsExceptionFilter {
  catch(exception: HttpException, host: ArgumentsHost) {
    const client = host.switchToWs().getClient<Socket>();
    client.emit('exception', {
      status: exception.getStatus(),
      message: exception.message,
    });
  }
}
