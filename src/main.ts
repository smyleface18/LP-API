import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { IoAdapter } from '@nestjs/platform-socket.io';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // CORS para HTTP
  app.enableCors({
    origin: '*', // En producción, especifica dominios: ['http://localhost:3000', 'https://tuapp.com']
    credentials: true,
  });

  // Socket.IO Adapter
  app.useWebSocketAdapter(new IoAdapter(app));

  // Escuchar en todas las interfaces (0.0.0.0) para red local
  const port = process.env.PORT ?? 3000;
  await app.listen(port, '0.0.0.0');

  console.log('🚀 API corriendo en:');
  console.log(`   - Local: http://localhost:${port}`);
  console.log(`   - Red:   http://[TU_IP]:${port}`);
}

bootstrap().catch((e) => {
  console.error('❌ API falló:', e);
});
