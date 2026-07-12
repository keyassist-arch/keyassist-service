import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Order } from '../orders/entities/order.entity';
import { User } from '../users/entities/user.entity';
import { TrackingModule } from '../tracking/tracking.module';
import { AdminService } from './admin.service';
import { AdminController } from './admin.controller';
import { AdminUsersService } from './admin-users.service';
import { AdminUsersController } from './admin-users.controller';
import { OrdersModule } from '../orders/orders.module';
import { ProductsModule } from '../products/products.module';
import { QueuesModule } from '../jobs/queues.module';
import { RealtimeModule } from '../realtime/realtime.module';
import { ShippingModule } from '../shipping/shipping.module';
import { ScraperModule } from '../scraper/scraper.module';
import { UsersModule } from '../users/users.module';
import { AuthModule } from '../auth/auth.module';
import { UploadsModule } from '../uploads/uploads.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Order, User]),
    TrackingModule,
    OrdersModule,
    ProductsModule,
    QueuesModule,
    RealtimeModule,
    ShippingModule,
    ScraperModule,
    UsersModule,
    AuthModule,
    UploadsModule,
  ],
  providers: [AdminService, AdminUsersService],
  controllers: [AdminController, AdminUsersController],
})
export class AdminModule {}
