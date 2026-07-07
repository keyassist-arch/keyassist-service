import { ConfigService } from '@nestjs/config';

/** Falls back FRONTEND_URL → PUBLIC_APP_URL → localhost, with no trailing slash. */
export function resolveFrontendBaseUrl(config: ConfigService): string {
  const url =
    config.get<string>('FRONTEND_URL')?.trim() ||
    config.get<string>('PUBLIC_APP_URL')?.trim();
  return (url || 'http://localhost:3000').replace(/\/$/, '');
}
