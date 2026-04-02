import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  chromium,
  Browser,
  type BrowserContext,
  type BrowserContextOptions,
} from 'playwright';
import { parseScrapeProxy } from './utils/parse-scrape-proxy.util';
import { pickScrapeUserAgent } from './utils/user-agent-rotation.util';

@Injectable()
export class PlaywrightService implements OnModuleDestroy {
  private readonly logger = new Logger(PlaywrightService.name);
  private browser: Browser | null = null;
  private launchPromise: Promise<Browser> | null = null;

  constructor(private readonly config: ConfigService) {}

  async getBrowser(): Promise<Browser> {
    if (this.browser) {
      return this.browser;
    }
    if (!this.launchPromise) {
      this.launchPromise = chromium.launch({
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox'],
      });
      if (this.config.get<string>('SCRAPE_PROXY')?.trim()) {
        this.logger.log(
          '[playwright] SCRAPE_PROXY set — applied per browser context (see newScrapeContext)',
        );
      }
    }
    this.browser = await this.launchPromise;
    return this.browser;
  }

  /**
   * Browser context for retail scrapes: optional proxy (also at launch if set),
   * default rotating User-Agent, adapter can override via `overrides`.
   */
  async newScrapeContext(
    overrides: BrowserContextOptions = {},
  ): Promise<BrowserContext> {
    const browser = await this.getBrowser();
    const proxyFromEnv = parseScrapeProxy(
      this.config.get<string>('SCRAPE_PROXY'),
    );
    const proxy = overrides.proxy ?? proxyFromEnv;
    const userAgent = overrides.userAgent ?? pickScrapeUserAgent();
    const locale =
      overrides.locale ?? this.config.get<string>('SCRAPE_LOCALE') ?? 'en-US';
    const timezoneId =
      overrides.timezoneId ??
      this.config.get<string>('SCRAPE_TIMEZONE_ID') ??
      'America/Los_Angeles';
    const acceptLang =
      this.config.get<string>('SCRAPE_ACCEPT_LANGUAGE') ?? 'en-US,en;q=0.9';
    return browser.newContext({
      ...overrides,
      locale,
      timezoneId,
      userAgent,
      ...(proxy ? { proxy } : {}),
      extraHTTPHeaders: {
        'Accept-Language': acceptLang,
        ...overrides.extraHTTPHeaders,
      },
    });
  }

  async onModuleDestroy(): Promise<void> {
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
      this.launchPromise = null;
    }
  }
}
