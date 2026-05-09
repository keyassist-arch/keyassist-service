import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  type Browser,
  type BrowserContext,
  type BrowserContextOptions,
} from 'playwright';
import { chromium } from 'playwright-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';

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

  async onModuleDestroy(): Promise<void> {
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
      this.launchPromise = null;
    }
  }
}
