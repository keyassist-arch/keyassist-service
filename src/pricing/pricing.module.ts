import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DiscountSettings } from './entities/discount-settings.entity';
import { DiscountSettingsService } from './discount-settings.service';

@Module({
  imports: [TypeOrmModule.forFeature([DiscountSettings])],
  providers: [DiscountSettingsService],
  exports: [DiscountSettingsService],
})
export class PricingModule {}
