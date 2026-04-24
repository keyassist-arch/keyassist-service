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

  if (!raw) {
    return { origin: true as const, credentials: true as const };
  }

  const allowlist = [
    ...new Set(
      raw
        .split(',')
        .map((o) => normalizeCorsOriginEntry(o))
        .filter(Boolean),
    ),
  ];

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
    // Omit allowedHeaders so preflight mirrors Access-Control-Request-Headers (RTK Query, Sentry, etc.)
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
