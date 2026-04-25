import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Order } from '../orders/entities/order.entity';
import { Refund } from './entities/refund.entity';
import { CustomerIssue } from './entities/customer-issue.entity';
import { ReconciliationService } from './reconciliation.service';
import { ReconciliationController } from './reconciliation.controller';
import { OrdersModule } from '../orders/orders.module';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Refund, CustomerIssue, Order]),
    OrdersModule,
    NotificationsModule,
  ],
  providers: [ReconciliationService],
  controllers: [ReconciliationController],
  exports: [ReconciliationService],
})
export class ReconciliationModule {}
