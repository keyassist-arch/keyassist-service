import { ConfigService } from '@nestjs/config';

/** Falls back FRONTEND_URL → PUBLIC_APP_URL → keyassistco.com, with no trailing slash. */
export function resolveFrontendBaseUrl(config: ConfigService): string {
  const url =
    config.get<string>('FRONTEND_URL')?.trim() ||
    config.get<string>('PUBLIC_APP_URL')?.trim();
  return (url || 'https://keyassistco.com').replace(/\/$/, '');
}
