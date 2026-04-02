import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { Logger } from '@nestjs/common';
import { QUEUE_VERIFY_PRICE } from '../queue.constants';
import { ProductsService } from '../../products/products.service';
import { ScraperService } from '../../scraper/scraper.service';

@Processor(QUEUE_VERIFY_PRICE)
export class VerifyPriceProcessor extends WorkerHost {
  private readonly logger = new Logger(VerifyPriceProcessor.name);

  constructor(
    private readonly productsService: ProductsService,
    private readonly scraper: ScraperService,
  ) {
    super();
  }

  async process(job: Job<{ productId: string }>): Promise<void> {
    const { productId } = job.data;
    this.logger.log(
      `[job:verify_price] step=start jobId=${job.id} productId=${productId}`,
    );
    try {
      const product = await this.productsService.findById(productId);
      this.logger.log(
        `[job:verify_price] step=scrape productId=${productId} source=${product.source}`,
      );
      const scraped = await this.scraper.scrape(
        product.sourceUrl,
        product.source,
      );
      await this.productsService.refreshPriceFromScrape(product, scraped);
      this.logger.log(
        `[job:verify_price] step=done productId=${productId} price=${scraped.price}`,
      );
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      this.logger.error(
        `[job:verify_price] step=failed productId=${productId}: ${msg}`,
        e instanceof Error ? e.stack : undefined,
      );
      throw e;
    }
  }
}
