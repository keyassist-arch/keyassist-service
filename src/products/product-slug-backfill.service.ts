import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

/**
 * When `synchronize` adds `slug` to an existing `products` table, rows start as NULL.
 * Mirrors migration `AddProductSlug1743340000000`: backfill so NOT NULL app logic and lookups work.
 */
@Injectable()
export class ProductSlugBackfillService implements OnApplicationBootstrap {
  private readonly logger = new Logger(ProductSlugBackfillService.name);

  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  async onApplicationBootstrap(): Promise<void> {
    try {
      const rows = await this.dataSource.query(
        `UPDATE products SET slug = id::text WHERE slug IS NULL RETURNING id`,
      );
      if (rows?.length) {
        this.logger.log(`[product] backfilled slug for ${rows.length} row(s)`);
      }
    } catch (e) {
      this.logger.warn(
        `[product] slug backfill skipped: ${e instanceof Error ? e.message : e}`,
      );
    }
  }
}
