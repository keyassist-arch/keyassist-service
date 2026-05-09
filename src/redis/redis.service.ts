import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import Redis from 'ioredis';
import { createHash } from 'crypto';
import { REDIS_CLIENT } from './redis.module';

const URL_PREFIX = 'product:url:';
const LOCK_PREFIX = 'scrape:lock:';
const DEFAULT_TTL_SEC = 3600;
/** Must exceed worst-case Playwright (e.g. Amazon + generic fallback) so imports don't look "stuck" while another request steals the lock. */
const LOCK_TTL_SEC = 300;

@Injectable()
export class RedisService {
  private readonly logger = new Logger(RedisService.name);

  constructor(
    @Optional()
    @Inject(REDIS_CLIENT)
    private readonly client: Redis | null | undefined,
  ) {}

  private enabled(): boolean {
    // Nest @Optional() may leave `undefined`; factory returns `null` when REDIS_URL is unset.
    return this.client != null;
  }

  urlKey(normalizedUrl: string): string {
    const hash = createHash('sha256').update(normalizedUrl).digest('hex');
    return `${URL_PREFIX}${hash}`;
  }

  lockKey(normalizedUrl: string): string {
    const hash = createHash('sha256').update(normalizedUrl).digest('hex');
    return `${LOCK_PREFIX}${hash}`;
  }

  async getCachedProductId(normalizedUrl: string): Promise<string | null> {
    if (!this.enabled()) return null;
    try {
      const v = await this.client!.get(this.urlKey(normalizedUrl));
      return v || null;
    } catch (err) {
      this.logger.warn(
        `[redis] getCachedProductId failed -- cache miss: ${(err as Error).message}`,
      );
      return null;
    }
  }

  async setCachedProductId(
    normalizedUrl: string,
    productId: string,
    ttlSec = DEFAULT_TTL_SEC,
  ): Promise<void> {
    if (!this.enabled()) return;
    try {
      await this.client!.set(
        this.urlKey(normalizedUrl),
        productId,
        'EX',
        ttlSec,
      );
    } catch (err) {
      this.logger.warn(
        `[redis] setCachedProductId failed -- skipping cache write: ${(err as Error).message}`,
      );
    }
  }

  /** Drop URL→product cache (e.g. before rescrape so clients poll fresh data). */
  async invalidateCachedProductUrl(normalizedUrl: string): Promise<void> {
    if (!this.enabled()) return;
    try {
      await this.client!.del(this.urlKey(normalizedUrl));
    } catch (err) {
      this.logger.warn(
        `[redis] invalidateCachedProductUrl failed -- cache may be stale: ${(err as Error).message}`,
      );
    }
  }

  /**
   * Attempts a SET NX (atomic test-and-set lock).
   * On Redis error: returns `true` so the caller proceeds -- this degrades to
   * the same behaviour as when Redis is not configured (no distributed lock,
   * but the process continues rather than hard-failing).
   */
  async acquireScrapeLock(normalizedUrl: string): Promise<boolean> {
    if (!this.enabled()) return true;
    try {
      const ok = await this.client!.set(
        this.lockKey(normalizedUrl),
        '1',
        'EX',
        LOCK_TTL_SEC,
        'NX',
      );
      return ok === 'OK';
    } catch (err) {
      this.logger.warn(
        `[redis] acquireScrapeLock failed -- proceeding without lock: ${(err as Error).message}`,
      );
      return true;
    }
  }

  async releaseScrapeLock(normalizedUrl: string): Promise<void> {
    if (!this.enabled()) return;
    try {
      await this.client!.del(this.lockKey(normalizedUrl));
    } catch (err) {
      this.logger.warn(
        `[redis] releaseScrapeLock failed -- lock will expire naturally after ${LOCK_TTL_SEC}s: ${(err as Error).message}`,
      );
    }
  }

  /** Called by RedisModule.onApplicationShutdown to close the connection cleanly. */
  async quit(): Promise<void> {
    if (!this.enabled()) return;
    try {
      await this.client!.quit();
    } catch {
      // Ignore errors during shutdown -- the process is exiting anyway.
    }
  }
}
