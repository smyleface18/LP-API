import { IoAdapter } from '@nestjs/platform-socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import { Redis } from 'ioredis';
import { Server, ServerOptions } from 'socket.io';

export class RedisIoAdapter extends IoAdapter {
  private adapterConstructor: ReturnType<typeof createAdapter> | null = null;

  connectToRedis() {
    const pubClient = new Redis({
      host: process.env.REDIS_HOST ?? 'localhost',
      port: parseInt(process.env.REDIS_PORT ?? '6379'),
    });

    const subClient = pubClient.duplicate();

    this.adapterConstructor = createAdapter(pubClient, subClient);
  }

  createIOServer(port: number, options?: ServerOptions): Server {
    if (!this.adapterConstructor) {
      throw new Error('Redis adapter not initialized');
    }

    const server = super.createIOServer(port, options) as Server;
    server.adapter(this.adapterConstructor);
    return server;
  }
}
