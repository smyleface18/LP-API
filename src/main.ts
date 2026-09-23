import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { Logger, ValidationPipe } from '@nestjs/common';
import { RedisIoAdapter } from './modules/game/redis-io.adapter';
import { ResponseInterceptor } from './common/src/api/response.interceptor';
import { HttpExceptionFilter } from './common/src/api/http-exception.filter';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // CORS para HTTP. CORS_ORIGINS (separados por coma) restringe los orígenes
  // permitidos; sin definir se aceptan todos, cómodo en desarrollo pero hay que
  // configurarlo en producción. Apps nativas no mandan Origin y no les afecta.
  const allowedOrigins = (process.env.CORS_ORIGINS ?? '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);

  app.enableCors({
    origin: allowedOrigins.length > 0 ? allowedOrigins : true,
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
  redisIoAdapter.connectToRedis();
  app.useWebSocketAdapter(redisIoAdapter);

  // Escuchar en todas las interfaces (0.0.0.0) para red local
  const port = process.env.PORT ?? 3000;
  await app.listen(port, '0.0.0.0');

  Logger.log(`API running on http://localhost:${port}`, 'Bootstrap');
}

bootstrap().catch((e) => {
  Logger.error('API failed to start', e instanceof Error ? e.stack : String(e), 'Bootstrap');
});
