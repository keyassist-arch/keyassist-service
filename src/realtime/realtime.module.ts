import { Module, forwardRef } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ConfigModule } from '@nestjs/config';
import { OrderGateway } from './order.gateway';
import { OrderRealtimeService } from './order-realtime.service';
import { ImportRealtimeService } from './import-realtime.service';
import { ProductImportModule } from '../product-import/product-import.module';

@Module({
  imports: [
    ConfigModule,
    JwtModule.register({}),
    forwardRef(() => ProductImportModule),
  ],
  providers: [OrderGateway, OrderRealtimeService, ImportRealtimeService],
  exports: [OrderRealtimeService, ImportRealtimeService],
})
export class RealtimeModule {}
