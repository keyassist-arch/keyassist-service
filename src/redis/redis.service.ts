import { Inject, Injectable, Optional } from '@nestjs/common';
import Redis from 'ioredis';
import { createHash } from 'crypto';
import { REDIS_CLIENT } from './redis.module';

const URL_PREFIX = 'product:url:';
const LOCK_PREFIX = 'scrape:lock:';
const DEFAULT_TTL_SEC = 3600;
/** Must exceed worst-case Playwright (e.g. Amazon + generic fallback) so imports don’t look “stuck” while another request steals the lock. */
const LOCK_TTL_SEC = 300;

@Injectable()
export class RedisService {
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
    const v = await this.client!.get(this.urlKey(normalizedUrl));
    return v || null;
  }

  async setCachedProductId(
    normalizedUrl: string,
    productId: string,
    ttlSec = DEFAULT_TTL_SEC,
  ): Promise<void> {
    if (!this.enabled()) return;
    await this.client!.set(this.urlKey(normalizedUrl), productId, 'EX', ttlSec);
  }

  /** Drop URL→product cache (e.g. before rescrape so clients poll fresh data). */
  async invalidateCachedProductUrl(normalizedUrl: string): Promise<void> {
    if (!this.enabled()) return;
    await this.client!.del(this.urlKey(normalizedUrl));
  }

  async acquireScrapeLock(normalizedUrl: string): Promise<boolean> {
    if (!this.enabled()) return true;
    const ok = await this.client!.set(
      this.lockKey(normalizedUrl),
      '1',
      'EX',
      LOCK_TTL_SEC,
      'NX',
    );
    return ok === 'OK';
  }

  async releaseScrapeLock(normalizedUrl: string): Promise<void> {
    if (!this.enabled()) return;
    await this.client!.del(this.lockKey(normalizedUrl));
  }
}
