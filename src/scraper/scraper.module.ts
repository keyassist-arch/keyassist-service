import { Global, Module } from '@nestjs/common';
import { PlaywrightService } from './playwright.service';
import { GenericAdapter } from './adapters/generic.adapter';
import { JumiaAdapter } from './adapters/jumia.adapter';
import { AmazonAdapter } from './adapters/amazon.adapter';
import { NikeAdapter } from './adapters/nike.adapter';
import { AppleAdapter } from './adapters/apple.adapter';
import { SheinAdapter } from './adapters/shein.adapter';
import { GoatAdapter } from './adapters/goat.adapter';
import { ZaraAdapter } from './adapters/zara.adapter';
import { ConverseAdapter } from './adapters/converse.adapter';
import { ScraperService } from './scraper.service';

@Global()
@Module({
  providers: [
    PlaywrightService,
    GenericAdapter,
    JumiaAdapter,
    AmazonAdapter,
    NikeAdapter,
    AppleAdapter,
    SheinAdapter,
    GoatAdapter,
    ZaraAdapter,
    ConverseAdapter,
    ScraperService,
  ],
  exports: [ScraperService, PlaywrightService],
})
export class ScraperModule {}
