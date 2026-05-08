import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { BullModule } from '@nestjs/bullmq';
import { validateEnv } from './config/env.validation';
import { JwtAuthGuard } from './common/guards/jwt-auth.guard';
import { RedisModule } from './redis/redis.module';
import { LlmModule } from './llm/llm.module';
import { ScraperModule } from './scraper/scraper.module';
import { NotificationsModule } from './notifications/notifications.module';
import { AuthModule } from './auth/auth.module';
import { UsersModule } from './users/users.module';
import { ProductsModule } from './products/products.module';
import { ProductImportModule } from './product-import/product-import.module';
import { QueuesModule } from './jobs/queues.module';
import { JobsModule } from './jobs/jobs.module';
import { CartModule } from './cart/cart.module';
import { OrdersModule } from './orders/orders.module';
import { PaymentModule } from './payment/payment.module';
import { AdminModule } from './admin/admin.module';
import { RealtimeModule } from './realtime/realtime.module';
import { ReconciliationModule } from './reconciliation/reconciliation.module';
import { TotpModule } from './totp/totp.module';
import { ShippingModule } from './shipping/shipping.module';
import { SavesModule } from './saves/saves.module';
import { PasskeyModule } from './passkey/passkey.module';
import { ApiRootController } from './api-root.controller';
import { HealthController } from './health.controller';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      validate: validateEnv,
    }),
    TotpModule,
    ThrottlerModule.forRoot({
      throttlers: [{ ttl: 60000, limit: 120 }],
    }),
    BullModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        connection: {
          url: config.get<string>('REDIS_URL') || 'redis://127.0.0.1:6379',
          /**
           * Both flags are required by BullMQ:
           *  - maxRetriesPerRequest: null  — blocking commands must not be
           *    abandoned after N retries; BullMQ manages its own retry logic.
           *  - enableReadyCheck: false     — skip the INFO ping so the client
           *    connects without waiting for Redis to report "ready", which
           *    prevents startup failures on slow or sentinel-managed instances.
           */
          maxRetriesPerRequest: null,
          enableReadyCheck: false,
          connectTimeout: 10_000,
          retryStrategy: (times: number) => Math.min(times * 200, 5_000),
        },
      }),
    }),
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const syncOverride = config
          .get<string>('DATABASE_SYNCHRONIZE')
          ?.trim()
          .toLowerCase();
        let synchronize = false;
        if (syncOverride === 'true') {
          synchronize = true;
        } else if (syncOverride === 'false') {
          synchronize = false;
        } else {
          synchronize = config.get<string>('NODE_ENV') === 'development';
        }
        return {
          type: 'postgres' as const,
          url:
            config.get<string>('DATABASE_URL') ||
            'postgres://postgres:postgres@127.0.0.1:5432/unified_commerce',
          autoLoadEntities: true,
          synchronize,
          /** Passed to `pg` Pool — reduces stale sockets (common cause of `read ECONNRESET`). */
          extra: {
            max: 15,
            idleTimeoutMillis: 20_000,
            connectionTimeoutMillis: 15_000,
          },
        };
      },
    }),
    RedisModule,
    NotificationsModule,
    LlmModule,
    ScraperModule,
    QueuesModule,
    AuthModule,
    UsersModule,
    ProductImportModule,
    ProductsModule,
    JobsModule,
    CartModule,
    OrdersModule,
    PaymentModule,
    AdminModule,
    RealtimeModule,
    ReconciliationModule,
    ShippingModule,
    SavesModule,
    PasskeyModule,
  ],
  controllers: [HealthController, ApiRootController],
  providers: [
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: ThrottlerGuard },
  ],
})
export class AppModule {}
