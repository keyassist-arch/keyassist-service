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

/** `http(s)://localhost:<port>` or `http(s)://127.0.0.1:<port>` — any port when using local dev against a hosted API. */
function isLocalLoopbackOrigin(origin: string | undefined): boolean {
  if (!origin) return false;
  try {
    const u = new URL(origin);
    const h = u.hostname.toLowerCase();
    return (
      (h === 'localhost' || h === '127.0.0.1') &&
      (u.protocol === 'http:' || u.protocol === 'https:')
    );
  } catch {
    return false;
  }
}

function buildCorsOptions(configService: ConfigService) {
  const raw = configService.get<string>('CORS_ORIGIN')?.trim();
  const mergeLocal =
    configService.get<string>('CORS_ALLOW_LOCALHOST')?.trim().toLowerCase() ===
    'true';

  // Hardcoded production and development origins
  const defaultOrigins = [
    'https://unified-commerce-frontend-production.up.railway.app',
    'http://localhost:3000',
    'http://localhost:3001',
    'http://127.0.0.1:3000',
    'http://127.0.0.1:3001',
  ];

  const envOrigins = raw
    ? raw
        .split(',')
        .map((o) => normalizeCorsOriginEntry(o))
        .filter(Boolean)
    : [];

  const allowlist = [...new Set([...defaultOrigins, ...envOrigins])];

  return {
    credentials: true as const,
    origin: (
      requestOrigin: string | undefined,
      cb: (err: Error | null, allow?: boolean | string) => void,
    ) => {
      if (!requestOrigin) {
        cb(null, true);
        return;
      }
      if (allowlist.includes(requestOrigin)) {
        cb(null, requestOrigin);
        return;
      }
      if (mergeLocal && isLocalLoopbackOrigin(requestOrigin)) {
        cb(null, requestOrigin);
        return;
      }
      cb(null, false);
    },
  };
}

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { rawBody: true });
  app.useGlobalFilters(new AllExceptionsFilter());

  const configService = app.get(ConfigService);
  const { origin, credentials } = buildCorsOptions(configService);
  app.enableCors({
    origin,
    credentials,
    methods: ['GET', 'HEAD', 'PUT', 'PATCH', 'POST', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'Accept'],
    exposedHeaders: ['Content-Type', 'X-Total-Count'],
    preflightContinue: false,
    optionsSuccessStatus: 200,
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
