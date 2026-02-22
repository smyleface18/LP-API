import { Socket } from 'socket.io';

export interface ConnectionGameSocket extends Socket {
  data: {
    userId: string;
    roomId: string;
  };
}
