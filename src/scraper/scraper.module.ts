import { Global, Module } from '@nestjs/common';
import { LlmModule } from '../llm/llm.module';
import { PlaywrightService } from './playwright.service';
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
import { ScraperService } from './scraper.service';
import { OpenRouterScrapeRefinementService } from './services/openrouter-scrape-refinement.service';

@Global()
@Module({
  imports: [LlmModule],
  providers: [
    PlaywrightService,
    GenericAdapter,
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
    ScraperService,
    OpenRouterScrapeRefinementService,
  ],
  exports: [ScraperService, PlaywrightService],
})
export class ScraperModule {}
