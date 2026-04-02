import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import { RedisService } from './redis.service';

export const REDIS_CLIENT = 'REDIS_CLIENT';

@Global()
@Module({
  providers: [
    {
      provide: REDIS_CLIENT,
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const url = config.get<string>('REDIS_URL')?.trim();
        if (!url) {
          return null;
        }
        return new Redis(url, { maxRetriesPerRequest: null });
      },
    },
    RedisService,
  ],
  exports: [REDIS_CLIENT, RedisService],
})
export class RedisModule {}
