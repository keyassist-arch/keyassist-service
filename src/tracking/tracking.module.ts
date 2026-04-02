import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { OrderTracking } from './entities/order-tracking.entity';

@Module({
  imports: [TypeOrmModule.forFeature([OrderTracking])],
  exports: [TypeOrmModule],
})
export class TrackingModule {}
