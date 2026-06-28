import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Order } from './entities/order.entity';
import { OrderItem } from './entities/order-item.entity';
import { WannaBuyItem } from '../wanna-buy/entities/wanna-buy-item.entity';
import { OrdersService } from './orders.service';
import { OrdersController } from './orders.controller';
import { CartModule } from '../cart/cart.module';
import { ProductsModule } from '../products/products.module';
import { UsersModule } from '../users/users.module';
import { QueuesModule } from '../jobs/queues.module';
import { RealtimeModule } from '../realtime/realtime.module';
import { ShippingModule } from '../shipping/shipping.module';
import { LandedCostModule } from '../landed-cost/landed-cost.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Order, OrderItem, WannaBuyItem]),
    CartModule,
    ProductsModule,
    UsersModule,
    QueuesModule,
    RealtimeModule,
    ShippingModule,
    LandedCostModule,
  ],
  providers: [OrdersService],
  controllers: [OrdersController],
  exports: [OrdersService],
})
export class OrdersModule {}
