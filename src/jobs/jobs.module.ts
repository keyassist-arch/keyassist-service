import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { ScrapeProductProcessor } from './processors/scrape-product.processor';
import { VerifyPriceProcessor } from './processors/verify-price.processor';
import { SendNotificationProcessor } from './processors/send-notification.processor';
import { RescrapeSchedulerService } from './rescrape-scheduler.service';
import { ProductImportModule } from '../product-import/product-import.module';
import { ProductsModule } from '../products/products.module';
import { ScraperModule } from '../scraper/scraper.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { QueuesModule } from './queues.module';

@Module({
  imports: [
    ScheduleModule.forRoot(),
    QueuesModule,
    ProductImportModule,
    ProductsModule,
    ScraperModule,
    NotificationsModule,
  ],
  providers: [
    ScrapeProductProcessor,
    VerifyPriceProcessor,
    SendNotificationProcessor,
    RescrapeSchedulerService,
  ],
})
export class JobsModule {}
