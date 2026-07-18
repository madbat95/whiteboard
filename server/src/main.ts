import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AppModule } from './app.module';
import { AuthService } from './auth/auth.service';
import { RedisIoAdapter } from './redis/redis-io.adapter';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  const config = app.get(ConfigService);

  const frontendOrigin = config.get<string>('FRONTEND_ORIGIN') ?? 'http://localhost:3000';
  const redisUrl = config.get<string>('REDIS_URL') ?? 'redis://localhost:6379';
  const port = config.get<string>('PORT') ?? 4000;

  // REST: cross-origin calls per contract §4 ("frontend calls the backend
  // URL DIRECTLY, not proxied through Next.js").
  app.enableCors({ origin: frontendOrigin, credentials: true });
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));

  // WS: Redis-backed adapter for multi-instance pub/sub (B7) + JWT handshake
  // auth that produces socket.io's built-in "connect_error" on rejection.
  const authService = app.get(AuthService);
  const redisIoAdapter = new RedisIoAdapter(app, redisUrl, authService, frontendOrigin);
  await redisIoAdapter.connectToRedis();
  app.useWebSocketAdapter(redisIoAdapter);

  await app.listen(port);
  // eslint-disable-next-line no-console
  console.log(`Whiteboard backend listening on :${port}`);
}

void bootstrap();
