import {
  InjectQueue,
  OnWorkerEvent,
  Processor,
  WorkerHost,
} from '@nestjs/bullmq';
import { Job, Queue } from 'bullmq';
import { Logger } from '@nestjs/common';
import { QUEUE_SCRAPE_PRODUCT, QUEUE_VERIFY_PRICE } from '../queue.constants';
import { ProductImportService } from '../../product-import/product-import.service';

@Processor(QUEUE_SCRAPE_PRODUCT, {
  /** Default Bull lock is 30s; Playwright scrapes routinely exceed that while still healthy. */
  lockDuration: 300_000,
})
export class ScrapeProductProcessor extends WorkerHost {
  private readonly logger = new Logger(ScrapeProductProcessor.name);

  constructor(
    private readonly productImportService: ProductImportService,
    @InjectQueue(QUEUE_VERIFY_PRICE)
    private readonly verifyPriceQueue: Queue<{ productId: string }>,
  ) {
    super();
  }

  @OnWorkerEvent('ready')
  onWorkerReady(): void {
    this.logger.log(
      `[job:scrape] worker=ready queue=${QUEUE_SCRAPE_PRODUCT} — subscribed to Redis; jobs should be picked immediately unless another worker holds them`,
    );
  }

  @OnWorkerEvent('active')
  onJobActive(job: Job<{ importId: string }>, prev: string): void {
    const queuedMs =
      job.processedOn != null && job.timestamp != null
        ? job.processedOn - job.timestamp
        : undefined;
    this.logger.log(
      `[job:scrape] worker=picked_job jobId=${String(job.id)} importId=${job.data.importId} prevState=${prev}` +
        (queuedMs != null ? ` queueWaitMs=${queuedMs}` : ''),
    );
  }

  @OnWorkerEvent('completed')
  onJobCompleted(
    job: Job<{ importId: string }>,
    _result: unknown,
    prev: string,
  ): void {
    const runMs =
      job.finishedOn != null && job.processedOn != null
        ? job.finishedOn - job.processedOn
        : undefined;
    this.logger.log(
      `[job:scrape] worker=job_completed jobId=${String(job.id)} importId=${job.data.importId} prevState=${prev}` +
        (runMs != null ? ` processRunMs=${runMs}` : ''),
    );
  }

  @OnWorkerEvent('failed')
  onJobFailed(
    job: Job<{ importId: string }> | undefined,
    err: Error,
    prev: string,
  ): void {
    this.logger.error(
      `[job:scrape] worker=job_failed jobId=${job ? String(job.id) : 'n/a'} importId=${job?.data?.importId} prevState=${prev}: ${err.message}`,
      err.stack,
    );
  }

  @OnWorkerEvent('error')
  onWorkerError(err: Error): void {
    this.logger.error(
      `[job:scrape] worker=redis_or_runtime_error: ${err.message}`,
      err.stack,
    );
  }

  @OnWorkerEvent('stalled')
  onStalled(jobId: string, prev: string): void {
    this.logger.warn(
      `[job:scrape] worker=stalled jobId=${jobId} prevState=${prev} — job returned to wait; check slow scrapes or Redis connectivity`,
    );
  }

  @OnWorkerEvent('drained')
  onDrained(): void {
    this.logger.log(
      `[job:scrape] worker=drained queue=${QUEUE_SCRAPE_PRODUCT} — no jobs waiting in this queue`,
    );
  }

  async process(job: Job<{ importId: string }>): Promise<void> {
    const { importId } = job.data;
    this.logger.log(
      `[job:scrape] step=start jobId=${job.id} importId=${importId} attemptsMade=${job.attemptsMade}`,
    );
    await this.productImportService.processScrapeJob(importId);
    this.logger.log(
      `[job:scrape] step=import_handler_finished importId=${importId}`,
    );
    const status = await this.productImportService.getImportStatus(importId);
    if (status.product?.id) {
      this.logger.log(
        `[job:scrape] step=enqueue_verify_price productId=${status.product.id} delayMs=60000`,
      );
      await this.verifyPriceQueue.add(
        'verify',
        { productId: status.product.id },
        { delay: 60_000, removeOnComplete: true },
      );
    } else {
      this.logger.log(
        `[job:scrape] step=skip_verify status=${status.status} importId=${importId}`,
      );
    }
  }
}
