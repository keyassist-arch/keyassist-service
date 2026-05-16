import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Product } from '../products/entities/product.entity';
import { CurrencyModule } from '../currency/currency.module';
import { LandedCostService } from './landed-cost.service';
import { LandedCostController } from './landed-cost.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([Product]),
    CurrencyModule,
  ],
  providers: [LandedCostService],
  controllers: [LandedCostController],
  exports: [LandedCostService],
})
export class LandedCostModule {}
