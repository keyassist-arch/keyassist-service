import { plainToInstance, Transform } from 'class-transformer';
import {
  IsEnum,
  IsNumber,
  IsOptional,
  IsString,
  Min,
  validateSync,
} from 'class-validator';

enum NodeEnv {
  Development = 'development',
  Production = 'production',
  Test = 'test',
}

class EnvironmentVariables {
  @IsEnum(NodeEnv)
  @IsOptional()
  NODE_ENV: NodeEnv = NodeEnv.Development;

  @Transform(({ value }) =>
    value === undefined || value === '' ? 3000 : Number(value),
  )
  @IsNumber()
  @Min(0)
  @IsOptional()
  PORT = 3000;

  @IsString()
  @IsOptional()
  DATABASE_URL?: string;

  @IsString()
  JWT_ACCESS_SECRET: string;

  @IsString()
  JWT_REFRESH_SECRET: string;

  @IsString()
  @IsOptional()
  REDIS_URL?: string;

  @IsString()
  @IsOptional()
  PAYSTACK_SECRET_KEY?: string;

  @IsString()
  @IsOptional()
  PAYSTACK_PUBLIC_KEY?: string;

  @IsString()
  @IsOptional()
  PAYSTACK_WEBHOOK_SECRET?: string;

  @IsString()
  @IsOptional()
  STRIPE_SECRET_KEY?: string;

  @IsString()
  @IsOptional()
  STRIPE_WEBHOOK_SECRET?: string;

  @IsString()
  @IsOptional()
  STRIPE_CHECKOUT_SUCCESS_URL?: string;

  @IsString()
  @IsOptional()
  STRIPE_CHECKOUT_CANCEL_URL?: string;

  @IsString()
  @IsOptional()
  RESEND_API_KEY?: string;

  /** e.g. "Acme <orders@yourdomain.com>" — must use a verified domain in production */
  @IsString()
  @IsOptional()
  RESEND_FROM?: string;

  @IsString()
  @IsOptional()
  MAIL_FROM?: string;

  /**
   * `true` / `1` — always send from Resend onboarding address (no verified domain).
   * `false` / `0` — use RESEND_FROM / MAIL_FROM even in development.
   * Unset — use onboarding outside production; use RESEND_FROM in production.
   */
  @IsString()
  @IsOptional()
  RESEND_SANDBOX?: string;

  /** Password-reset email links: https://your-app/reset-password?token=... */
  @IsString()
  @IsOptional()
  FRONTEND_URL?: string;

  @IsString()
  @IsOptional()
  PUBLIC_APP_URL?: string;

  @IsString()
  @IsOptional()
  JWT_PASSWORD_RESET_SECRET?: string;

  @IsString()
  @IsOptional()
  PASSWORD_RESET_TOKEN_EXPIRES?: string;

  /** Optional; separate secret for email verification links (defaults to JWT_PASSWORD_RESET_SECRET, then JWT_REFRESH_SECRET). */
  @IsString()
  @IsOptional()
  JWT_EMAIL_VERIFICATION_SECRET?: string;

  @IsString()
  @IsOptional()
  EMAIL_VERIFICATION_TOKEN_EXPIRES?: string;

  /** Comma-separated browser origins, e.g. http://localhost:3000. Empty = echo request Origin. */
  @IsString()
  @IsOptional()
  CORS_ORIGIN?: string;

  /** Optional Playwright proxy (e.g. Bright Data / Smartproxy): http://user:pass@host:port */
  @IsString()
  @IsOptional()
  SCRAPE_PROXY?: string;

  /** Playwright BCP 47 locale (avoids wrong storefront HTML e.g. ko-KR vs en-US) */
  @IsString()
  @IsOptional()
  SCRAPE_LOCALE?: string;

  /** Request header Accept-Language sent with navigations */
  @IsString()
  @IsOptional()
  SCRAPE_ACCEPT_LANGUAGE?: string;

  /** IANA timezone for consistent regional pricing display */
  @IsString()
  @IsOptional()
  SCRAPE_TIMEZONE_ID?: string;

  @Transform(({ value }) =>
    value === undefined || value === '' ? 10 : Number(value),
  )
  @IsNumber()
  @Min(0)
  @IsOptional()
  DEFAULT_MARKUP_PERCENT = 10;
}

export function validateEnv(config: Record<string, unknown>) {
  const validated = plainToInstance(EnvironmentVariables, config, {
    enableImplicitConversion: true,
  });
  const errors = validateSync(validated, {
    skipMissingProperties: false,
  });
  if (errors.length > 0) {
    throw new Error(errors.toString());
  }
  return validated;
}
