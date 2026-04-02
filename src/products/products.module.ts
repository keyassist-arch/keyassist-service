import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Product } from './entities/product.entity';
import { ImportedProduct } from './entities/imported-product.entity';
import { ProductSlugBackfillService } from './product-slug-backfill.service';
import { ProductsService } from './products.service';
import { ProductsController } from './products.controller';

@Module({
  imports: [TypeOrmModule.forFeature([Product, ImportedProduct])],
  providers: [ProductsService, ProductSlugBackfillService],
  controllers: [ProductsController],
  exports: [ProductsService, TypeOrmModule],
})
export class ProductsModule {}
