import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Order } from '../orders/entities/order.entity';
import { User } from '../users/entities/user.entity';
import { TrackingModule } from '../tracking/tracking.module';
import { AdminService } from './admin.service';
import { AdminController } from './admin.controller';
import { OrdersModule } from '../orders/orders.module';
import { ProductsModule } from '../products/products.module';
import { QueuesModule } from '../jobs/queues.module';
import { RealtimeModule } from '../realtime/realtime.module';
import { ShippingModule } from '../shipping/shipping.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Order, User]),
    TrackingModule,
    OrdersModule,
    ProductsModule,
    QueuesModule,
    RealtimeModule,
    ShippingModule,
  ],
  providers: [AdminService],
  controllers: [AdminController],
})
export class AdminModule {}
