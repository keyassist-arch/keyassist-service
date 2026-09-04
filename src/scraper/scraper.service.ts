import { Inject, Injectable, Logger } from '@nestjs/common';
import { ProductSource } from '../common/enums/product-source.enum';
import { previewText, previewUrl } from '../common/utils/log-preview.util';
import { ScrapedProduct } from './interfaces/scraped-product.interface';
import {
  SCRAPER_ADAPTER_TOKEN,
  type ScraperAdapter,
} from './interfaces/scraper-adapter.interface';
import { detectProductSource } from './utils/detect-source.util';
import { GenericAdapter } from './adapters/generic.adapter';
import { ScrapeRefinementService } from './services/scrape-refinement.service';

const MAX_ATTEMPTS = 3;
const RETRY_BASE_MS = 2_000;

/**
 * Transient errors worth retrying: network failures, timeouts, proxy errors,
 * rate limits (429), and upstream 5xx. Permanent errors (404, bad URL, adapter
 * logic failures) are not retried — they will not succeed on a second attempt.
 */
function isTransientError(e: unknown): boolean {
  const msg = (e instanceof Error ? e.message : String(e)).toLowerCase();
  return (
    msg.includes('timeout') ||
    msg.includes('econnreset') ||
    msg.includes('econnrefused') ||
    msg.includes('enotfound') ||
    msg.includes('socket hang up') ||
    msg.includes('network') ||
    msg.includes('429') ||
    msg.includes('rate limit') ||
    msg.includes('503') ||
    msg.includes('502') ||
    msg.includes('504')
  );
}

@Injectable()
export class ScraperService {
  private readonly logger = new Logger(ScraperService.name);
  private readonly adapters: Map<ProductSource, ScraperAdapter>;

  constructor(
    private readonly llmRefine: ScrapeRefinementService,
    @Inject(SCRAPER_ADAPTER_TOKEN) adapterList: ScraperAdapter[],
    private readonly generic: GenericAdapter,
  ) {
    this.adapters = new Map(adapterList.map((a) => [a.source, a]));
  }

  private logScrapeSummary(
    source: ProductSource,
    url: string,
    result: ScrapedProduct,
  ): void {
    this.logger.log(
      `[scrape] step=result ` +
        `source=${source} ` +
        `url=${previewUrl(url)} ` +
        `title=${previewText(result.title, 80)} ` +
        `price=${result.price} ` +
        `currency=${result.currency} ` +
        `images=${result.images?.length ?? 0} ` +
        `variants=${result.variants?.length ?? 0} ` +
        `configRows=${result.configurationPrices?.length ?? 0} ` +
        `availability=${result.availability ?? 'n/a'}`,
    );
  }

  detectSource(url: string): ProductSource {
    return detectProductSource(url);
  }

  async scrape(url: string, source?: ProductSource): Promise<ScrapedProduct> {
    const s = source ?? this.detectSource(url);
    const adapter = this.adapters.get(s) ?? this.generic;
    this.logger.log(`[scrape] step=adapter source=${s} url=${previewUrl(url)}`);

    let lastError: unknown;

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      try {
        let result = await adapter.scrape(url);
        if (this.llmRefine.isEnabled()) {
          result = await this.llmRefine.refine(url, result);
        }
        if (attempt > 1) {
          this.logger.log(
            `[scrape] step=recovered source=${s} attempt=${attempt} url=${previewUrl(url)}`,
          );
        }
        this.logger.log(
          `[scrape] step=ok source=${s} title=${previewText(result.title, 60)}`,
        );
        this.logScrapeSummary(s, url, result);
        return result;
      } catch (e) {
        lastError = e;
        const msg = e instanceof Error ? e.message : String(e);

        if (!isTransientError(e) || attempt === MAX_ATTEMPTS) {
          this.logger.error(
            `[scrape] step=fail source=${s} attempt=${attempt}/${MAX_ATTEMPTS} url=${previewUrl(url)}: ${msg}`,
            e instanceof Error ? e.stack : undefined,
          );
          throw e;
        }

        const delayMs = RETRY_BASE_MS * 2 ** (attempt - 1);
        this.logger.warn(
          `[scrape] step=retry source=${s} attempt=${attempt}/${MAX_ATTEMPTS} delayMs=${delayMs} reason=${msg}`,
        );
        await new Promise((r) => setTimeout(r, delayMs));
      }
    }

    // Unreachable — loop always returns or throws — but satisfies TypeScript.
    throw lastError;
  }
}
