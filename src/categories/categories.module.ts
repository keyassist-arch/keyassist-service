import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Category } from './entities/category.entity';
import { Product } from '../products/entities/product.entity';
import { CategoriesService } from './categories.service';
import { CategoriesController } from './categories.controller';
import { CategoryClassifierService } from './category-classifier.service';
import { ProductsModule } from '../products/products.module';
import { CurrencyModule } from '../currency/currency.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Category, Product]),
    ProductsModule,
    CurrencyModule,
  ],
  providers: [CategoriesService, CategoryClassifierService],
  controllers: [CategoriesController],
  exports: [CategoriesService, CategoryClassifierService],
})
export class CategoriesModule {}
