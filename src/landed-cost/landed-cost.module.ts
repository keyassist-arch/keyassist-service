import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Product } from '../products/entities/product.entity';
import { CurrencyModule } from '../currency/currency.module';
import { ShippingModule } from '../shipping/shipping.module';
import { CartModule } from '../cart/cart.module';
import { ProductsModule } from '../products/products.module';
import { LandedCostService } from './landed-cost.service';
import { LandedCostController } from './landed-cost.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([Product]),
    CurrencyModule,
    ShippingModule,
    CartModule,
    ProductsModule,
  ],
  providers: [LandedCostService],
  controllers: [LandedCostController],
  exports: [LandedCostService],
})
export class LandedCostModule {}
