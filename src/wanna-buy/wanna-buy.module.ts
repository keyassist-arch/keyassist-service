import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Batch } from './entities/batch.entity';
import { WannaBuyItem } from './entities/wanna-buy-item.entity';
import { WannaBuyService } from './wanna-buy.service';
import { WannaBuyController } from './wanna-buy.controller';
import { ScraperModule } from '../scraper/scraper.module';
import { CurrencyModule } from '../currency/currency.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { UsersModule } from '../users/users.module';
import { RealtimeModule } from '../realtime/realtime.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Batch, WannaBuyItem]),
    ScraperModule,
    CurrencyModule,
    NotificationsModule,
    UsersModule,
    RealtimeModule,
  ],
  providers: [WannaBuyService],
  controllers: [WannaBuyController],
  exports: [WannaBuyService],
})
export class WannaBuyModule {}
