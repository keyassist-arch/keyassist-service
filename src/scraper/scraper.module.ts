import { Module } from '@nestjs/common';
import { LlmModule } from '../llm/llm.module';
import { PlaywrightService } from './playwright.service';
import { ScraperService } from './scraper.service';
import { ScrapeRefinementService } from './services/scrape-refinement.service';
import { SCRAPER_ADAPTER_TOKEN } from './interfaces/scraper-adapter.interface';
import { GenericAdapter } from './adapters/generic.adapter';
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
import { BackMarketAdapter } from './adapters/backmarket.adapter';
import { WalmartAdapter } from './adapters/walmart.adapter';
import { ReebeloAdapter } from './adapters/reebelo.adapter';

@Module({
  imports: [LlmModule],
  providers: [
    PlaywrightService,
    GenericAdapter,
    ScrapeRefinementService,
    // Individual adapter providers — NestJS instantiates each one.
    JumiaAdapter,
    AmazonAdapter,
    NikeAdapter,
    AppleAdapter,
    SheinAdapter,
    GoatAdapter,
    StockxAdapter,
    EbayAdapter,
    ZaraAdapter,
    ConverseAdapter,
    EtsyAdapter,
    BackMarketAdapter,
    WalmartAdapter,
    ReebeloAdapter,
    // Factory collects all adapter instances into the array ScraperService expects.
    {
      provide: SCRAPER_ADAPTER_TOKEN,
      useFactory: (
        jumia: JumiaAdapter,
        amazon: AmazonAdapter,
        nike: NikeAdapter,
        apple: AppleAdapter,
        shein: SheinAdapter,
        goat: GoatAdapter,
        stockx: StockxAdapter,
        ebay: EbayAdapter,
        zara: ZaraAdapter,
        converse: ConverseAdapter,
        etsy: EtsyAdapter,
        backMarket: BackMarketAdapter,
        walmart: WalmartAdapter,
        reebelo: ReebeloAdapter,
      ) => [
        jumia, amazon, nike, apple, shein, goat, stockx,
        ebay, zara, converse, etsy, backMarket, walmart, reebelo,
      ],
      inject: [
        JumiaAdapter, AmazonAdapter, NikeAdapter, AppleAdapter,
        SheinAdapter, GoatAdapter, StockxAdapter, EbayAdapter,
        ZaraAdapter, ConverseAdapter, EtsyAdapter, BackMarketAdapter,
        WalmartAdapter, ReebeloAdapter,
      ],
    },
    ScraperService,
  ],
  exports: [ScraperService, PlaywrightService],
})
export class ScraperModule {}
