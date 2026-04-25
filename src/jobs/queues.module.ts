import { Global, Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import {
  QUEUE_PROCESS_REFUND,
  QUEUE_SCRAPE_PRODUCT,
  QUEUE_SEND_NOTIFICATION,
  QUEUE_VERIFY_PRICE,
} from './queue.constants';

@Global()
@Module({
  imports: [
    BullModule.registerQueue(
      {
        name: QUEUE_SCRAPE_PRODUCT,
        defaultJobOptions: {
          // Per-job opts in ProductImportService (attempts: 2, backoff) take precedence.
          // This floor ensures stale completed/failed rows don't pile up in Redis.
          removeOnComplete: { count: 500 },
          removeOnFail: { count: 200 },
        },
      },
      {
        name: QUEUE_VERIFY_PRICE,
        defaultJobOptions: {
          attempts: 3,
          backoff: { type: 'exponential', delay: 30_000 },
          removeOnComplete: { count: 500 },
          removeOnFail: { count: 200 },
        },
      },
      {
        name: QUEUE_SEND_NOTIFICATION,
        defaultJobOptions: {
          attempts: 3,
          backoff: { type: 'exponential', delay: 2_000 },
          removeOnComplete: { count: 500 },
          removeOnFail: { count: 200 },
        },
      },
      {
        name: QUEUE_PROCESS_REFUND,
        defaultJobOptions: {
          attempts: 3,
          backoff: { type: 'exponential', delay: 5_000 },
          removeOnComplete: { count: 200 },
          removeOnFail: { count: 100 },
        },
      },
    ),
  ],
  exports: [BullModule],
})
export class QueuesModule {}
