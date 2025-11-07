import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { IoAdapter } from '@nestjs/platform-socket.io';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // ✅ Habilitar CORS para WebSockets
  app.enableCors({
    origin: '*', // Solo desarrollo
  });

  // ✅ Activar Socket.IO Adapter
  app.useWebSocketAdapter(new IoAdapter(app));

  await app.listen(process.env.PORT ?? 3000);
  console.log('🚀 API WebSocket corriendo en http://localhost:3000');
}
bootstrap().catch((e) => {
  console.error('api faild ❌', e);
});
