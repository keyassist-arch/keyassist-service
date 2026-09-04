import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  type Browser,
  type BrowserContext,
  type BrowserContextOptions,
  type Page,
} from 'playwright';
import { chromium } from 'playwright-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import { scrapeDoGet } from './utils/scrape-do-client.util';

export type LoadPageOptions = {
  contextOverrides?: BrowserContextOptions;
  /** ms to wait after page load for JS rendering via scrape.do (default 4000) */
  scrapeDoWait?: number;
  gotoOptions?: { waitUntil: 'load' | 'domcontentloaded' | 'networkidle'; timeout: number };
};

export type LoadedPage = {
  page: Page;
  context: BrowserContext;
  source: 'scrape.do' | 'playwright';
};

chromium.use(StealthPlugin());
import { parseScrapeProxy } from './utils/parse-scrape-proxy.util';
import { pickScrapeUserAgent } from './utils/user-agent-rotation.util';

type GeoProfile = {
  geoCode?: string;
  locale: string;
  timezoneId: string;
  acceptLanguage: string;
};

const GEO_PROFILES: Record<string, Omit<GeoProfile, 'geoCode'>> = {
  us: {
    locale: 'en-US',
    timezoneId: 'America/Los_Angeles',
    acceptLanguage: 'en-US,en;q=0.9',
  },
  gb: {
    locale: 'en-GB',
    timezoneId: 'Europe/London',
    acceptLanguage: 'en-GB,en;q=0.9',
  },
  de: {
    locale: 'de-DE',
    timezoneId: 'Europe/Berlin',
    acceptLanguage: 'de-DE,de;q=0.9,en;q=0.7',
  },
  fr: {
    locale: 'fr-FR',
    timezoneId: 'Europe/Paris',
    acceptLanguage: 'fr-FR,fr;q=0.9,en;q=0.7',
  },
  it: {
    locale: 'it-IT',
    timezoneId: 'Europe/Rome',
    acceptLanguage: 'it-IT,it;q=0.9,en;q=0.7',
  },
  es: {
    locale: 'es-ES',
    timezoneId: 'Europe/Madrid',
    acceptLanguage: 'es-ES,es;q=0.9,en;q=0.7',
  },
  nl: {
    locale: 'nl-NL',
    timezoneId: 'Europe/Amsterdam',
    acceptLanguage: 'nl-NL,nl;q=0.9,en;q=0.7',
  },
  pl: {
    locale: 'pl-PL',
    timezoneId: 'Europe/Warsaw',
    acceptLanguage: 'pl-PL,pl;q=0.9,en;q=0.7',
  },
  ng: {
    locale: 'en-NG',
    timezoneId: 'Africa/Lagos',
    acceptLanguage: 'en-NG,en;q=0.9',
  },
  ae: {
    locale: 'en-AE',
    timezoneId: 'Asia/Dubai',
    acceptLanguage: 'en-AE,en;q=0.9,ar;q=0.6',
  },
};

/**
 * Warn when open context count reaches this level. Each scrape job opens one
 * context and closes it in a finally block — under normal operation the count
 * stays at 1–3. A rising count means adapters are not closing their contexts.
 */
const CONTEXT_LEAK_WARN_THRESHOLD = 10;

@Injectable()
export class PlaywrightService implements OnModuleDestroy {
  private readonly logger = new Logger(PlaywrightService.name);
  private browser: Browser | null = null;
  private launchPromise: Promise<Browser> | null = null;

  constructor(private readonly config: ConfigService) {}

  /**
   * TLS to the origin through many residential/datacenter proxies is effectively MITM; Chromium
   * often does not trust that chain (ERR_CERT_AUTHORITY_INVALID). Default: ignore when
   * `SCRAPE_PROXY` is set, unless explicitly disabled with `SCRAPE_IGNORE_HTTPS_ERRORS=false`.
   */
  private resolveIgnoreHttpSErrors(overrides: BrowserContextOptions): boolean {
    if (overrides.ignoreHTTPSErrors != null) {
      return overrides.ignoreHTTPSErrors;
    }
    const raw = this.config.get<string>('SCRAPE_IGNORE_HTTPS_ERRORS')?.trim();
    if (raw) {
      const lo = raw.toLowerCase();
      if (lo === 'true' || lo === '1' || lo === 'yes') return true;
      if (lo === 'false' || lo === '0' || lo === 'no') return false;
    }
    return Boolean(this.config.get<string>('SCRAPE_PROXY')?.trim());
  }

  async getBrowser(): Promise<Browser> {
    if (this.browser) {
      return this.browser;
    }
    if (!this.launchPromise) {
      this.launchPromise = chromium.launch({
        headless: true,
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--no-zygote',
          '--disable-background-networking',
          '--disable-default-apps',
          '--disable-extensions',
          '--disable-sync',
          '--no-first-run',
        ],
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
  private countryFromUrl(targetUrl?: string): string | undefined {
    if (!targetUrl) return undefined;
    try {
      const h = new URL(targetUrl).hostname.toLowerCase();
      const suffixMap: Record<string, string> = {
        'co.uk': 'gb',
        'com.ng': 'ng',
        'com.tr': 'tr',
      };
      for (const [suffix, country] of Object.entries(suffixMap)) {
        if (h.endsWith(`.${suffix}`) || h === suffix) {
          return country;
        }
      }
      const parts = h.split('.');
      const tld = parts[parts.length - 1];
      if (tld && /^[a-z]{2}$/i.test(tld)) {
        return tld.toLowerCase();
      }
      return undefined;
    } catch {
      return undefined;
    }
  }

  private resolveGeoProfile(targetUrl?: string): GeoProfile {
    const forcedGeo = this.config.get<string>('SCRAPE_PROXY_GEO_CODE')?.trim();
    const inferredGeo = this.countryFromUrl(targetUrl);
    const geoCode = (forcedGeo || inferredGeo || '').toLowerCase() || undefined;
    const base = (geoCode && GEO_PROFILES[geoCode]) || GEO_PROFILES.us;
    return {
      geoCode,
      locale: this.config.get<string>('SCRAPE_LOCALE') ?? base.locale,
      timezoneId:
        this.config.get<string>('SCRAPE_TIMEZONE_ID') ?? base.timezoneId,
      acceptLanguage:
        this.config.get<string>('SCRAPE_ACCEPT_LANGUAGE') ??
        base.acceptLanguage,
    };
  }

  async newScrapeContext(
    overrides: BrowserContextOptions = {},
    targetUrl?: string,
  ): Promise<BrowserContext> {
    const browser = await this.getBrowser();
    const profile = this.resolveGeoProfile(targetUrl);
    const proxyFromEnv = parseScrapeProxy(
      this.config.get<string>('SCRAPE_PROXY'),
      profile.geoCode,
    );
    const proxy = overrides.proxy ?? proxyFromEnv;
    const userAgent = overrides.userAgent ?? pickScrapeUserAgent();
    const locale = overrides.locale ?? profile.locale;
    const timezoneId = overrides.timezoneId ?? profile.timezoneId;
    const acceptLang = profile.acceptLanguage;
    const ignoreHTTPSErrors = this.resolveIgnoreHttpSErrors(overrides);
    return browser.newContext({
      ...overrides,
      locale,
      timezoneId,
      userAgent,
      ignoreHTTPSErrors,
      ...(proxy ? { proxy } : {}),
      extraHTTPHeaders: {
        'Accept-Language': acceptLang,
        ...overrides.extraHTTPHeaders,
      },
    });
  }

  private async fetchHtmlViaScrapeD0(url: string, wait: number): Promise<string | null> {
    const token = this.config.get<string>('SCRAPE_DO_TOKEN')?.trim();
    if (!token) return null;
    try {
      const { data: html } = await scrapeDoGet<string>(
        token,
        url,
        { super: 'true', wait: String(wait) },
        { responseType: 'text' },
      );
      if (typeof html !== 'string' || html.length < 500) return null;
      return html;
    } catch (e) {
      this.logger.warn(
        `[playwright] scrape.do fetch failed: ${e instanceof Error ? e.message : String(e)}`,
      );
      return null;
    }
  }

  private checkContextLeak(): void {
    if (!this.browser) return;
    const open = this.browser.contexts().length;
    this.logger.debug(`[playwright] openContexts=${open}`);
    if (open >= CONTEXT_LEAK_WARN_THRESHOLD) {
      this.logger.warn(
        `[playwright] openContexts=${open} exceeds threshold=${CONTEXT_LEAK_WARN_THRESHOLD}` +
          ` — adapters must close their context in a finally block`,
      );
    }
  }

  /**
   * Fetch a page via scrape.do first (if SCRAPE_DO_TOKEN is set), falling back to
   * Playwright's own navigation. The returned page is ready for page.evaluate() — close
   * the context in a finally block when done.
   */
  async loadPage(url: string, options: LoadPageOptions = {}): Promise<LoadedPage> {
    const {
      contextOverrides = {},
      scrapeDoWait = 4000,
      gotoOptions = { waitUntil: 'domcontentloaded', timeout: 60_000 },
    } = options;

    const html = await this.fetchHtmlViaScrapeD0(url, scrapeDoWait);
    const context = await this.newScrapeContext(contextOverrides, url);
    this.checkContextLeak();
    const page = await context.newPage();

    if (html) {
      this.logger.log(`[playwright] loadPage source=scrape.do url=${url.slice(0, 80)}`);
      // Serve the pre-fetched HTML for the top-level navigation instead of
      // page.setContent(): setContent() leaves the page on `about:blank`
      // (origin "null"), which throws SecurityErrors on cookies/XHR/history
      // APIs and silently breaks any client-side hydration or relative
      // fetches (e.g. price XHRs) the page tries to run afterwards. Routing
      // the real URL to fulfill with our HTML keeps the correct origin while
      // still avoiding a second live fetch of the document itself.
      await page.route(url, (route) =>
        route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: html }),
      );
      await page.goto(url, gotoOptions).catch((e) => {
        this.logger.warn(
          `[playwright] scrape.do-fulfilled goto failed, content may be partial: ${
            e instanceof Error ? e.message : String(e)
          }`,
        );
      });
      await page.unroute(url).catch(() => undefined);
      return { page, context, source: 'scrape.do' };
    }

    this.logger.log(`[playwright] loadPage source=playwright url=${url.slice(0, 80)}`);
    await page.goto(url, gotoOptions);
    return { page, context, source: 'playwright' };
  }

  async onModuleDestroy(): Promise<void> {
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
      this.launchPromise = null;
    }
  }
}
