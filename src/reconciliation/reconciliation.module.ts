import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Order } from '../orders/entities/order.entity';
import { Refund } from './entities/refund.entity';
import { CustomerIssue } from './entities/customer-issue.entity';
import { ReconciliationService } from './reconciliation.service';
import { ReconciliationController } from './reconciliation.controller';
import { ReconciliationUserController } from './reconciliation-user.controller';
import { OrdersModule } from '../orders/orders.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { QueuesModule } from '../jobs/queues.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Refund, CustomerIssue, Order]),
    OrdersModule,
    NotificationsModule,
    QueuesModule,
  ],
  providers: [ReconciliationService],
  controllers: [ReconciliationController, ReconciliationUserController],
  exports: [ReconciliationService],
})
export class ReconciliationModule {}
