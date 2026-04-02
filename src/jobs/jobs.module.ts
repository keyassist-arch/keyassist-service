import { Module } from '@nestjs/common';
import { ScrapeProductProcessor } from './processors/scrape-product.processor';
import { VerifyPriceProcessor } from './processors/verify-price.processor';
import { SendNotificationProcessor } from './processors/send-notification.processor';
import { ProductImportModule } from '../product-import/product-import.module';
import { ProductsModule } from '../products/products.module';
import { ScraperModule } from '../scraper/scraper.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { QueuesModule } from './queues.module';

@Module({
  imports: [
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
  ],
})
export class JobsModule {}
