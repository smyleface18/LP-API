import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ValidationPipe } from '@nestjs/common';
import { RedisIoAdapter } from './modules/game/redis-io.adapter';
import { ResponseInterceptor } from './common/src/api/response.interceptor';
import { HttpExceptionFilter } from './common/src/api/http-exception.filter';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // CORS para HTTP
  app.enableCors({
    origin: '*', // En producción, especifica dominios: ['http://localhost:3000', 'https://tuapp.com']
    credentials: true,
  });

  // reponse interceptor
  app.useGlobalInterceptors(new ResponseInterceptor());

  // filter inteceptor http
  app.useGlobalFilters(new HttpExceptionFilter());

  // ValidationPipe global
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true, // Remueve propiedades que no están en el DTO
      forbidNonWhitelisted: true, // Lanza error si hay propiedades extra
      transform: true, // Transforma payloads a instancias de DTO
      transformOptions: {
        enableImplicitConversion: true, // Convierte tipos automáticamente
      },
    }),
  );

  // Socket.IO Adapter
  const redisIoAdapter = new RedisIoAdapter(app);
  await redisIoAdapter.connectToRedis();
  app.useWebSocketAdapter(redisIoAdapter);

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
