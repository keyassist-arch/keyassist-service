import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AppModule } from './app.module';
import { setupSwagger } from './swagger';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';

const LOCALHOST_ORIGIN = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/;

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { rawBody: true });
  app.useGlobalFilters(new AllExceptionsFilter());

  const config = app.get(ConfigService);
  const allowedOrigins = (config.get<string>('CORS_ORIGIN') ?? '')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);
  const allowLocalhost =
    config.get<string>('CORS_ALLOW_LOCALHOST')?.trim().toLowerCase() === 'true';

  app.enableCors({
    origin: (origin, callback) => {
      if (!origin) return callback(null, true); // non-browser clients (curl, server-to-server)
      if (allowedOrigins.length === 0) return callback(null, true); // unset = echo request origin
      if (allowedOrigins.includes(origin)) return callback(null, true);
      if (allowLocalhost && LOCALHOST_ORIGIN.test(origin)) return callback(null, true);
      callback(new Error(`Origin ${origin} not allowed by CORS`), false);
    },
    credentials: true,
    methods: 'GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS',
    allowedHeaders: 'Origin,X-Requested-With,Content-Type,Accept,Authorization',
    exposedHeaders: 'Content-Length,X-Total-Count',
    preflightContinue: false,
    optionsSuccessStatus: 200,
  });

  setupSwagger(app);
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );
  const port = Number(process.env.PORT) || 3000;
  await app.listen(port, '0.0.0.0');
}
bootstrap();
