import { OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { Logger } from '@nestjs/common';
import { QUEUE_VERIFY_PRICE } from '../queue.constants';
import { ProductsService } from '../../products/products.service';
import { ScraperService } from '../../scraper/scraper.service';
import { CheckoutSimulatorService } from '../../scraper/services/checkout-simulator.service';

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
    private readonly checkoutSimulator: CheckoutSimulatorService,
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
  async onJobFailed(
    job: Job<{ productId: string }> | undefined,
    err: Error,
    prev: string,
  ): Promise<void> {
    const attemptsLeft =
      job != null
        ? (job.opts.attempts ?? 1) - (job.attemptsMade ?? 0)
        : undefined;
    this.logger.error(
      `[job:verify_price] worker=job_failed jobId=${job ? String(job.id) : 'n/a'} ` +
        `productId=${job?.data?.productId} prevState=${prev} attemptsLeft=${attemptsLeft ?? 'n/a'}: ${err.message}`,
      err.stack,
    );

    // On permanent failure, remove the job so the jobId slot is freed.
    // Without this, jobId: 'rescrape-<productId>' would stay in the failed set
    // and BullMQ would silently drop every subsequent add() with the same jobId,
    // meaning the cron could never retry the product.
    if (job != null && attemptsLeft === 0) {
      this.logger.warn(
        `[job:verify_price] worker=permanent_failure jobId=${String(job.id)} productId=${job.data.productId} — removing to free jobId slot for next cron tick`,
      );
      await job.remove().catch((removeErr: unknown) =>
        this.logger.error(
          `[job:verify_price] worker=remove_failed jobId=${String(job.id)}: ${removeErr instanceof Error ? removeErr.message : String(removeErr)}`,
        ),
      );
    }
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

    // Simulate guest checkout to capture actual tax for this address.
    // Fire-and-forget on failure — never fails the verify-price job.
    const taxAmountUsd = await this.checkoutSimulator.simulate(
      product.sourceUrl,
      product.source,
    );
    if (taxAmountUsd !== null) {
      await this.productsService.updateObservedTax(productId, taxAmountUsd);
      this.logger.log(
        `[job:verify_price] step=tax_simulated productId=${productId} taxAmountUsd=${taxAmountUsd.toFixed(2)}`,
      );
    }
    // Errors propagate uncaught — BullMQ catches them, triggers the failed event,
    // and respects the retry/backoff config set in QueuesModule defaultJobOptions.
  }
}
