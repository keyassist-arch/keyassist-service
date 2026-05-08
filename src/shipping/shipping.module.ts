import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ShippingRates } from './entities/shipping-rates.entity';
import { ShippingRatesService } from './shipping-rates.service';
import { ShippingService } from './shipping.service';
import { ShippingController } from './shipping.controller';

@Module({
  imports: [TypeOrmModule.forFeature([ShippingRates])],
  controllers: [ShippingController],
  providers: [ShippingRatesService, ShippingService],
  exports: [ShippingService, ShippingRatesService],
})
export class ShippingModule {}
