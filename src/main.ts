import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AppModule } from './app.module';
import { setupSwagger } from './swagger';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';

/** Browser `Origin` values always include a scheme; accept `localhost:3000` as shorthand. */
function normalizeCorsOriginEntry(raw: string): string {
  const o = raw.trim().replace(/\/+$/, '');
  if (!o) return '';
  if (/^https?:\/\//i.test(o)) return o;
  return `http://${o}`;
}

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { rawBody: true });
  app.useGlobalFilters(new AllExceptionsFilter());

  const configService = app.get(ConfigService);
  const corsOrigins = configService.get<string>('CORS_ORIGIN');
  const origin = corsOrigins?.trim()
    ? [
        ...new Set(
          corsOrigins
            .split(',')
            .map((o) => normalizeCorsOriginEntry(o))
            .filter(Boolean),
        ),
      ]
    : true;
  app.enableCors({
    origin,
    methods: ['GET', 'HEAD', 'PUT', 'PATCH', 'POST', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'Accept'],
    credentials: true,
    maxAge: 86_400,
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
