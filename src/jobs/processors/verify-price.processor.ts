import { OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { Logger } from '@nestjs/common';
import { QUEUE_VERIFY_PRICE } from '../queue.constants';
import { ProductsService } from '../../products/products.service';
import { ScraperService } from '../../scraper/scraper.service';

@Processor(QUEUE_VERIFY_PRICE, {
  /**
   * Default BullMQ lock is 30 s — scraping a product page can take that long or more.
   * If the lock expires while the job is still running, BullMQ marks it as stalled and
   * re-queues it, causing a duplicate scrape. 120 s gives plenty of headroom.
   */
  lockDuration: 120_000,
})
export class VerifyPriceProcessor extends WorkerHost {
  private readonly logger = new Logger(VerifyPriceProcessor.name);

  constructor(
    private readonly productsService: ProductsService,
    private readonly scraper: ScraperService,
  ) {
    super();
  }

  @OnWorkerEvent('ready')
  onWorkerReady(): void {
    this.logger.log(
      `[job:verify_price] worker=ready queue=${QUEUE_VERIFY_PRICE}`,
    );
  }

  @OnWorkerEvent('active')
  onJobActive(job: Job<{ productId: string }>, prev: string): void {
    const queuedMs =
      job.processedOn != null && job.timestamp != null
        ? job.processedOn - job.timestamp
        : undefined;
    this.logger.log(
      `[job:verify_price] worker=picked_job jobId=${String(job.id)} productId=${job.data.productId} prevState=${prev}` +
        (queuedMs != null ? ` queueWaitMs=${queuedMs}` : ''),
    );
  }

  @OnWorkerEvent('completed')
  onJobCompleted(
    job: Job<{ productId: string }>,
    _result: unknown,
    prev: string,
  ): void {
    const runMs =
      job.finishedOn != null && job.processedOn != null
        ? job.finishedOn - job.processedOn
        : undefined;
    this.logger.log(
      `[job:verify_price] worker=job_completed jobId=${String(job.id)} productId=${job.data.productId} prevState=${prev}` +
        (runMs != null ? ` processRunMs=${runMs}` : ''),
    );
  }

  @OnWorkerEvent('failed')
  onJobFailed(
    job: Job<{ productId: string }> | undefined,
    err: Error,
    prev: string,
  ): void {
    const attemptsLeft =
      job != null
        ? (job.opts.attempts ?? 1) - (job.attemptsMade ?? 0)
        : undefined;
    this.logger.error(
      `[job:verify_price] worker=job_failed jobId=${job ? String(job.id) : 'n/a'} ` +
        `productId=${job?.data?.productId} prevState=${prev} attemptsLeft=${attemptsLeft ?? 'n/a'}: ${err.message}`,
      err.stack,
    );
  }

  @OnWorkerEvent('error')
  onWorkerError(err: Error): void {
    this.logger.error(
      `[job:verify_price] worker=redis_or_runtime_error: ${err.message}`,
      err.stack,
    );
  }

  @OnWorkerEvent('stalled')
  onStalled(jobId: string, prev: string): void {
    this.logger.warn(
      `[job:verify_price] worker=stalled jobId=${jobId} prevState=${prev} — ` +
        'job exceeded lock duration; check slow scrapes or increase lockDuration',
    );
  }

  @OnWorkerEvent('drained')
  onDrained(): void {
    this.logger.log(
      `[job:verify_price] worker=drained queue=${QUEUE_VERIFY_PRICE} — no jobs waiting`,
    );
  }

  async process(job: Job<{ productId: string }>): Promise<void> {
    const { productId } = job.data;
    this.logger.log(
      `[job:verify_price] step=start jobId=${job.id} productId=${productId} attemptsMade=${job.attemptsMade}`,
    );
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
    // Errors propagate uncaught — BullMQ catches them, triggers the failed event,
    // and respects the retry/backoff config set in QueuesModule defaultJobOptions.
  }
}
