import { Global, Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import {
  QUEUE_SCRAPE_PRODUCT,
  QUEUE_SEND_NOTIFICATION,
  QUEUE_VERIFY_PRICE,
} from './queue.constants';

@Global()
@Module({
  imports: [
    BullModule.registerQueue(
      { name: QUEUE_SCRAPE_PRODUCT },
      { name: QUEUE_VERIFY_PRICE },
      { name: QUEUE_SEND_NOTIFICATION },
    ),
  ],
  exports: [BullModule],
})
export class QueuesModule {}
