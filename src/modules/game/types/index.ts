import { PartialType } from '@nestjs/mapped-types';
import { Socket } from 'socket.io';

export interface ConnectionGameSocket extends Socket {
  data: {
    userId: string;
    roomId: string;
  };
}

export class CreateGameDto {}

export interface GatewayResponse<T = unknown> {
  ok: boolean;
  data?: T;
  error?: {
    message: string;
    code: string;
  };
}

export class UpdateGameDto extends PartialType(CreateGameDto) {
  id: number;
}
