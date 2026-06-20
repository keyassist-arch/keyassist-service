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
  /** `development` | `production` | `test`. Unset = not development (TypeORM synchronize off). */
  @IsEnum(NodeEnv)
  @IsOptional()
  NODE_ENV?: NodeEnv;

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

  /**
   * Overrides TypeORM `synchronize`: `true` = on, `false` = off. If unset, synchronize runs only
   * when `NODE_ENV` is exactly `development` (never on production/staging/test).
   */
  @IsString()
  @IsOptional()
  DATABASE_SYNCHRONIZE?: string;

  @IsString()
  JWT_ACCESS_SECRET: string;

  @IsString()
  JWT_REFRESH_SECRET: string;

  /** Optional; signed short-lived token after password OK when 2FA is enabled (defaults to JWT_ACCESS_SECRET). */
  @IsString()
  @IsOptional()
  JWT_2FA_PREAUTH_SECRET?: string;

  /** Short-lived pre-2FA session token TTL (default 5m). */
  @IsString()
  @IsOptional()
  JWT_2FA_PREAUTH_EXPIRES?: string;

  /** Display name in authenticator apps (e.g. Google Authenticator). */
  @IsString()
  @IsOptional()
  TOTP_ISSUER_NAME?: string;

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
  PAYPAL_CLIENT_ID?: string;

  @IsString()
  @IsOptional()
  PAYPAL_SECRET_KEY?: string;

  /** PayPal’s usual name; used if `PAYPAL_SECRET_KEY` is empty */
  @IsString()
  @IsOptional()
  PAYPAL_CLIENT_SECRET?: string;

  /** `sandbox` (default) | `live` | `production` / `prod` (same as live) */
  @IsString()
  @IsOptional()
  PAYPAL_MODE?: string;

  @IsString()
  @IsOptional()
  PAYPAL_RETURN_URL?: string;

  @IsString()
  @IsOptional()
  PAYPAL_CANCEL_URL?: string;

  @IsString()
  @IsOptional()
  MYAZA_API_KEY?: string;

  @IsString()
  @IsOptional()
  MYAZA_BASE_URL?: string;

  /** Path for POST that creates a checkout session, e.g. /api/v1/pos/sessions */
  @IsString()
  @IsOptional()
  MYAZA_SESSIONS_PATH?: string;

  @IsString()
  @IsOptional()
  MYAZA_CHAIN?: string;

  @IsString()
  @IsOptional()
  MYAZA_TOKEN?: string;

  @IsString()
  @IsOptional()
  MYAZA_EXPIRES_MINUTES?: string;

  @IsString()
  @IsOptional()
  MYAZA_RETURN_URL?: string;

  @IsString()
  @IsOptional()
  MYAZA_CANCEL_URL?: string;

  @IsString()
  @IsOptional()
  MYAZA_WEBHOOK_SECRET?: string;

  /** Optional absolute webhook URL override sent to Myaza when creating sessions */
  @IsString()
  @IsOptional()
  MYAZA_WEBHOOK_URL?: string;

  /** Chain for the POS sessions quote endpoint — defaults to MYAZA_CHAIN when not set */
  @IsString()
  @IsOptional()
  MYAZA_QUOTE_CHAIN?: string;

  /** Override URL for the POS sessions quote endpoint (default: {MYAZA_BASE_URL}/api/v1/pos/sessions/quote) */
  @IsString()
  @IsOptional()
  MYAZA_QUOTE_URL?: string;

  /** Optional temporary kill-switches for checkout method availability (set to `true` / `1` to hide+disable). */
  @IsString()
  @IsOptional()
  PAYMENT_DISABLE_PAYSTACK?: string;

  @IsString()
  @IsOptional()
  PAYMENT_DISABLE_STRIPE?: string;

  @IsString()
  @IsOptional()
  PAYMENT_DISABLE_PAYPAL?: string;

  @IsString()
  @IsOptional()
  PAYMENT_DISABLE_MYAZA?: string;

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

  /**
   * When `true`, allow any `http(s)://localhost:*` or `http(s)://127.0.0.1:*` Origin in addition to `CORS_ORIGIN` entries.
   */
  @IsString()
  @IsOptional()
  CORS_ALLOW_LOCALHOST?: string;

  /** Optional Playwright proxy (e.g. Bright Data / Smartproxy): http://user:pass@host:port */
  @IsString()
  @IsOptional()
  SCRAPE_PROXY?: string;

  /** Optional geotarget for Scrape.do proxy auth params (e.g. `us`, `gb`, `de`). */
  @IsString()
  @IsOptional()
  SCRAPE_PROXY_GEO_CODE?: string;

  /**
   * Scrape.do API token. When set, StockX (and other heavily-protected sites) use the
   * scrape.do render API instead of direct Playwright, bypassing Cloudflare bot detection.
   * Get yours at https://scrape.do — the free tier is sufficient for testing.
   */
  @IsString()
  @IsOptional()
  SCRAPE_DO_TOKEN?: string;

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

  /**
   * `true` / `1` / `false` / `0` — Playwright `ignoreHTTPSErrors`. When `SCRAPE_PROXY` is set,
   * the default is to ignore (many proxies present an untrusted MITM cert). Set `false` to
   * opt out. When no proxy, default is off unless you set this to `true` (e.g. local SSL inspection).
   */
  @IsString()
  @IsOptional()
  SCRAPE_IGNORE_HTTPS_ERRORS?: string;

  /** `false` / `0` — disable LLM scrape refinement even when a provider is configured. Defaults to ON whenever LLM_PROVIDER is available. */
  @IsString()
  @IsOptional()
  SCRAPE_LLM_REFINE?: string;

  /** @deprecated Renamed to SCRAPE_LLM_REFINE — still accepted for backward compat. */
  @IsString()
  @IsOptional()
  SCRAPE_OPENROUTER_REFINE?: string;

  /**
   * Optional OpenRouter model override specifically for the scrape-refinement + description pass.
   * Recommended free options: `google/gemini-2.0-flash-exp:free`, `meta-llama/llama-4-scout:free`
   * Recommended paid:        `anthropic/claude-haiku-4-5`, `google/gemini-1.5-pro`
   * Defaults to OPEN_ROUTER_MODEL when unset.
   */
  @IsString()
  @IsOptional()
  SCRAPE_REFINE_MODEL?: string;

  /**
   * LLM provider: `openrouter` (default) or `gemini`.
   * Switch to `gemini` to call Google AI Studio directly without going through OpenRouter.
   */
  @IsString()
  @IsOptional()
  LLM_PROVIDER?: string;

  /** Google AI Studio API key — required when LLM_PROVIDER=gemini. Get one at https://aistudio.google.com/app/apikey */
  @IsString()
  @IsOptional()
  GEMINI_API_KEY?: string;

  /** Gemini model to use (default: gemini-2.0-flash). Examples: gemini-1.5-pro, gemini-2.5-pro-preview-03-25 */
  @IsString()
  @IsOptional()
  GEMINI_MODEL?: string;

  /** Default inference temperature for all LLM calls (default: 0.1). */
  @IsString()
  @IsOptional()
  LLM_TEMPERATURE?: string;

  /** Max tokens per LLM completion (default: 4096). */
  @IsString()
  @IsOptional()
  LLM_MAX_TOKENS?: string;

  /** Request timeout in ms for LLM calls (default: 30000). */
  @IsString()
  @IsOptional()
  LLM_TIMEOUT_MS?: string;

  /** Must be `true` to enable the OpenRouter LLM gateway (Stepfun flash by default). */
  @IsString()
  @IsOptional()
  OPEN_ROUTER_ENABLED?: string;

  /** OpenRouter API key (alias: OPENROUTER_API_KEY). */
  @IsString()
  @IsOptional()
  OPEN_ROUTER_API_KEY?: string;

  @IsString()
  @IsOptional()
  OPENROUTER_API_KEY?: string;

  /** e.g. stepfun/step-3.5-flash:free (alias: OPENROUTER_MODEL) */
  @IsString()
  @IsOptional()
  OPEN_ROUTER_MODEL?: string;

  @IsString()
  @IsOptional()
  OPENROUTER_MODEL?: string;

  /** Optional; OpenRouter may require an HTTP Referer for some keys */
  @IsString()
  @IsOptional()
  OPENROUTER_HTTP_REFERER?: string;

  /** Default system prompt for `LlmGatewayService` (optional). */
  @IsString()
  @IsOptional()
  LLM_SYSTEM_PROMPT?: string;

  /**
   * WebAuthn Relying Party ID — the bare domain of your frontend, no protocol or path
   * (e.g. `example.com` or `localhost`). Required to use passkeys.
   */
  @IsString()
  @IsOptional()
  PASSKEY_RP_ID?: string;

  /** Human-readable site name shown in passkey dialogs (e.g. "My Store"). */
  @IsString()
  @IsOptional()
  PASSKEY_RP_NAME?: string;

  /**
   * Comma-separated allowed origins for WebAuthn verification
   * (e.g. `https://example.com,http://localhost:3000`).
   * Falls back to FRONTEND_URL / PUBLIC_APP_URL when unset.
   */
  @IsString()
  @IsOptional()
  PASSKEY_ORIGIN?: string;

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
