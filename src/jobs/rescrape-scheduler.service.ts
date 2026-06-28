import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { subHours } from 'date-fns';
import { ProductsService } from '../products/products.service';
import { QUEUE_VERIFY_PRICE } from './queue.constants';

/** How stale a product must be before it is eligible for a rescrape. */
const RESCRAPE_AFTER_HOURS = 24;
/** Max products enqueued per cron tick — prevents burst-flooding the scraper. */
const BATCH_LIMIT = 100;

@Injectable()
export class RescrapeSchedulerService {
  private readonly logger = new Logger(RescrapeSchedulerService.name);

  constructor(
    private readonly productsService: ProductsService,
    @InjectQueue(QUEUE_VERIFY_PRICE)
    private readonly verifyPriceQueue: Queue<{ productId: string }>,
  ) {}

  @Cron(CronExpression.EVERY_HOUR)
  async schedulePendingRescrapes(): Promise<void> {
    const cutoff = subHours(new Date(), RESCRAPE_AFTER_HOURS);
    const candidates = await this.productsService.findCandidatesForRescrape(
      cutoff,
      BATCH_LIMIT,
    );

    if (!candidates.length) {
      this.logger.log('[rescrape] step=tick candidates=0 — nothing stale');
      return;
    }

    let enqueued = 0;
    let skipped = 0;
    for (const product of candidates) {
      const jobId = `rescrape-${product.id}`;
      // BullMQ silently ignores add() when a job with the same jobId already
      // exists in waiting/active/delayed state — check first so we can log it.
      const existing = await this.verifyPriceQueue.getJob(jobId);
      if (existing) {
        const state = await existing.getState();
        if (state === 'active' || state === 'waiting' || state === 'delayed') {
          skipped++;
          continue;
        }
        // Permanent failure wasn't cleaned up (e.g. process restarted mid-flight).
        // Remove the stale job so the fresh add() below succeeds.
        await existing.remove().catch(() => undefined);
      }

      await this.verifyPriceQueue.add(
        'verify',
        { productId: product.id },
        { jobId },
      );
      enqueued++;
    }

    this.logger.log(
      `[rescrape] step=tick enqueued=${enqueued} skipped=${skipped} cutoffHours=${RESCRAPE_AFTER_HOURS}`,
    );
  }
}
