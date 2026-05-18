import { Injectable, Logger } from '@nestjs/common';
import { ProductSource } from '../common/enums/product-source.enum';
import { previewText, previewUrl } from '../common/utils/log-preview.util';
import { ScrapedProduct } from './interfaces/scraped-product.interface';
import type { ScraperAdapter } from './interfaces/scraper-adapter.interface';
import { detectProductSource } from './utils/detect-source.util';
import { JumiaAdapter } from './adapters/jumia.adapter';
import { AmazonAdapter } from './adapters/amazon.adapter';
import { NikeAdapter } from './adapters/nike.adapter';
import { AppleAdapter } from './adapters/apple.adapter';
import { SheinAdapter } from './adapters/shein.adapter';
import { GoatAdapter } from './adapters/goat.adapter';
import { StockxAdapter } from './adapters/stockx.adapter';
import { EbayAdapter } from './adapters/ebay.adapter';
import { ZaraAdapter } from './adapters/zara.adapter';
import { ConverseAdapter } from './adapters/converse.adapter';
import { EtsyAdapter } from './adapters/etsy.adapter';
import { GenericAdapter } from './adapters/generic.adapter';
import { ScrapeRefinementService } from './services/scrape-refinement.service';

@Injectable()
export class ScraperService {
  private readonly logger = new Logger(ScraperService.name);
  private readonly adapters: Map<ProductSource, ScraperAdapter>;

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

  constructor(
    private readonly llmRefine: ScrapeRefinementService,
    private readonly jumia: JumiaAdapter,
    private readonly amazon: AmazonAdapter,
    private readonly nike: NikeAdapter,
    private readonly apple: AppleAdapter,
    private readonly shein: SheinAdapter,
    private readonly goat: GoatAdapter,
    private readonly stockx: StockxAdapter,
    private readonly ebay: EbayAdapter,
    private readonly zara: ZaraAdapter,
    private readonly converse: ConverseAdapter,
    private readonly etsy: EtsyAdapter,
    private readonly generic: GenericAdapter,
  ) {
    const entries: [ProductSource, ScraperAdapter][] = [
      [ProductSource.JUMIA, jumia],
      [ProductSource.AMAZON, amazon],
      [ProductSource.NIKE, nike],
      [ProductSource.APPLE, apple],
      [ProductSource.SHEIN, shein],
      [ProductSource.GOAT, goat],
      [ProductSource.STOCKX, stockx],
      [ProductSource.EBAY, ebay],
      [ProductSource.ZARA, zara],
      [ProductSource.CONVERSE, converse],
      [ProductSource.ETSY, etsy],
      [ProductSource.GENERIC, generic],
    ];
    this.adapters = new Map(entries);
  }

  detectSource(url: string): ProductSource {
    return detectProductSource(url);
  }

  async scrape(url: string, source?: ProductSource): Promise<ScrapedProduct> {
    const s = source ?? this.detectSource(url);
    const adapter = this.adapters.get(s) ?? this.generic;
    this.logger.log(`[scrape] step=adapter source=${s} url=${previewUrl(url)}`);
    try {
      let result = await adapter.scrape(url);
      if (this.llmRefine.isEnabled()) {
        result = await this.llmRefine.refine(url, result);
      }
      this.logger.log(
        `[scrape] step=ok source=${s} title=${previewText(result.title, 60)}`,
      );
      this.logScrapeSummary(s, url, result);
      return result;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      this.logger.error(
        `[scrape] step=fail source=${s} url=${previewUrl(url)}: ${msg}`,
        e instanceof Error ? e.stack : undefined,
      );
      throw e;
    }
  }
}
