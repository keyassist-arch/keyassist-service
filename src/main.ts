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

const LOCAL_DEV_ORIGINS = ['http://localhost:3000', 'http://127.0.0.1:3000'];

function buildCorsOrigin(configService: ConfigService): boolean | string[] {
  const raw = configService.get<string>('CORS_ORIGIN')?.trim();
  const mergeLocal =
    configService.get<string>('CORS_ALLOW_LOCALHOST')?.trim().toLowerCase() ===
    'true';
  if (!raw) {
    return true;
  }
  const list = [
    ...new Set(
      raw
        .split(',')
        .map((o) => normalizeCorsOriginEntry(o))
        .filter(Boolean),
    ),
  ];
  if (mergeLocal) {
    for (const o of LOCAL_DEV_ORIGINS) {
      if (!list.includes(o)) {
        list.push(o);
      }
    }
  }
  return list;
}

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { rawBody: true });
  app.useGlobalFilters(new AllExceptionsFilter());

  const configService = app.get(ConfigService);
  const origin = buildCorsOrigin(configService);
  app.enableCors({
    origin,
    methods: ['GET', 'HEAD', 'PUT', 'PATCH', 'POST', 'DELETE', 'OPTIONS'],
    // Omit allowedHeaders so preflight mirrors Access-Control-Request-Headers (RTK Query, Sentry, etc.)
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
