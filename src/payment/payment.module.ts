import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PaymentService } from './payment.service';
import { PaymentController } from './payment.controller';
import { OrdersModule } from '../orders/orders.module';
import { UsersModule } from '../users/users.module';
import { SavedPaymentMethod } from './entities/saved-payment-method.entity';

@Module({
  imports: [TypeOrmModule.forFeature([SavedPaymentMethod]), OrdersModule, UsersModule],
  providers: [PaymentService],
  controllers: [PaymentController],
})
export class PaymentModule {}
