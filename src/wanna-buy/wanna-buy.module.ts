import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Batch } from './entities/batch.entity';
import { WannaBuyItem } from './entities/wanna-buy-item.entity';
import { WannaBuyService } from './wanna-buy.service';
import { WannaBuyController } from './wanna-buy.controller';
import { CurrencyModule } from '../currency/currency.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { UsersModule } from '../users/users.module';
import { RealtimeModule } from '../realtime/realtime.module';
import { ReconciliationModule } from '../reconciliation/reconciliation.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Batch, WannaBuyItem]),
    CurrencyModule,
    NotificationsModule,
    UsersModule,
    RealtimeModule,
    ReconciliationModule,
  ],
  providers: [WannaBuyService],
  controllers: [WannaBuyController],
  exports: [WannaBuyService],
})
export class WannaBuyModule {}
