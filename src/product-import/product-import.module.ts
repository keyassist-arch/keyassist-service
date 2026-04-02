import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ImportedProduct } from '../products/entities/imported-product.entity';
import { ProductImportService } from './product-import.service';
import { ProductImportController } from './product-import.controller';
import { ProductsModule } from '../products/products.module';
import { ScraperModule } from '../scraper/scraper.module';
import { RedisModule } from '../redis/redis.module';
import { QueuesModule } from '../jobs/queues.module';
import { RealtimeModule } from '../realtime/realtime.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([ImportedProduct]),
    ProductsModule,
    ScraperModule,
    RedisModule,
    QueuesModule,
    forwardRef(() => RealtimeModule),
  ],
  providers: [ProductImportService],
  controllers: [ProductImportController],
  exports: [ProductImportService],
})
export class ProductImportModule {}
