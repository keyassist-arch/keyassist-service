import { Global, Logger, Module, OnApplicationShutdown } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import { RedisService } from './redis.service';

export const REDIS_CLIENT = 'REDIS_CLIENT';

const logger = new Logger('RedisModule');

function buildClient(url: string): Redis {
  const client = new Redis(url, {
    /**
     * BullMQ requirement: null = don't limit retries per command (needed for
     * blocking calls like BRPOP). For our own usage it also avoids the default
     * "3 retries then throw" behaviour that masks transient blips.
     */
    maxRetriesPerRequest: null,
    /**
     * BullMQ recommendation: skip the ready-check ping so the client reports
     * "ready" as soon as the TCP socket is open instead of waiting for an INFO
     * round-trip. Avoids false-alarm connection errors on slow Redis starts.
     */
    enableReadyCheck: false,
    /** Don't hang the process waiting for a TCP handshake that will never come. */
    connectTimeout: 10_000,
    /**
     * Exponential back-off: 200 ms → 400 → ... capped at 5 s.
     * Returning null would stop retrying entirely (not what we want).
     */
    retryStrategy(times: number) {
      const delay = Math.min(times * 200, 5_000);
      logger.warn(
        `[redis] reconnect attempt #${times} -- next try in ${delay} ms`,
      );
      return delay;
    },
    /**
     * Reconnect automatically after ECONNRESET (server closed the socket) and
     * READONLY (Sentinel promoted a new primary mid-flight).
     */
    reconnectOnError(err: Error) {
      return (
        err.message.includes('ECONNRESET') || err.message.includes('READONLY')
      );
    },
  });

  // Without this listener any connection error is an unhandled EventEmitter
  // event, which crashes the Node.js process with an uncaughtException.
  client.on('error', (err: Error) =>
    logger.error(`[redis] client error: ${err.message}`),
  );
  client.on('connect', () => logger.log('[redis] connected'));
  client.on('reconnecting', () => logger.warn('[redis] reconnecting...'));
  client.on('close', () => logger.warn('[redis] connection closed'));

  return client;
}

@Global()
@Module({
  providers: [
    {
      provide: REDIS_CLIENT,
      inject: [ConfigService],
      useFactory: (config: ConfigService): Redis | null => {
        const url = config.get<string>('REDIS_URL')?.trim();
        if (!url) {
          logger.warn(
            '[redis] REDIS_URL not set -- caching and scrape-locks disabled',
          );
          return null;
        }
        return buildClient(url);
      },
    },
    RedisService,
  ],
  exports: [REDIS_CLIENT, RedisService],
})
export class RedisModule implements OnApplicationShutdown {
  constructor(private readonly redisService: RedisService) {}

  async onApplicationShutdown() {
    await this.redisService.quit();
  }
}
