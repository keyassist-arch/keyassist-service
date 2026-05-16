import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  ServiceUnavailableException,
  forwardRef,
} from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { InjectRepository } from '@nestjs/typeorm';
import { QueryFailedError, Repository } from 'typeorm';
import { ImportedProduct } from '../products/entities/imported-product.entity';
import { ImportStatus } from '../common/enums/import-status.enum';
import { ScraperService } from '../scraper/scraper.service';
import { ProductSource } from '../common/enums/product-source.enum';
import { normalizeProductUrl } from './utils/normalize-url.util';
import { RedisService } from '../redis/redis.service';
import { ProductsService } from '../products/products.service';
import { QUEUE_SCRAPE_PRODUCT } from '../jobs/queue.constants';
import { previewText, previewUrl } from '../common/utils/log-preview.util';
import {
  importPhaseFromStatus,
  pendingImportHints,
} from './import-client-hints';
import { ImportRealtimeService } from '../realtime/import-realtime.service';
import { ManualProductImportDto } from './dto/manual-product-import.dto';
import { CategoryClassifierService } from '../categories/category-classifier.service';

const SCRAPE_JOB_OPTS = {
  removeOnComplete: true,
  attempts: 2,
  backoff: { type: 'exponential' as const, delay: 5000 },
};

/** Bull states where a job is already in the pipeline — do not duplicate */
const IN_FLIGHT_BULL_STATES = new Set([
  'active',
  'waiting',
  'delayed',
  'prioritized',
  'waiting-children',
]);

@Injectable()
export class ProductImportService {
  private readonly logger = new Logger(ProductImportService.name);

  constructor(
    @InjectRepository(ImportedProduct)
    private readonly imports: Repository<ImportedProduct>,
    private readonly scraper: ScraperService,
    private readonly productsService: ProductsService,
    private readonly redis: RedisService,
    @InjectQueue(QUEUE_SCRAPE_PRODUCT)
    private readonly scrapeQueue: Queue,
    @Inject(forwardRef(() => ImportRealtimeService))
    private readonly importRealtime: ImportRealtimeService,
    private readonly categoryClassifier: CategoryClassifierService,
  ) {}

  /**
   * DB can be QUEUED/PROCESSING while Redis has no job (Redis restart, crash before add,
   * or a failed Bull job still keyed by jobId). Heal by removing dead Bull rows and re-adding.
   */
  private async ensureScrapeJobInRedis(
    importId: string,
    normalizedUrl: string,
    dbStatus: ImportStatus.QUEUED | ImportStatus.PROCESSING,
  ): Promise<void> {
    const job = await this.scrapeQueue.getJob(importId);
    if (job) {
      const state = await job.getState();
      if (IN_FLIGHT_BULL_STATES.has(state)) {
        const delayedHint =
          state === 'delayed'
            ? ' (retry backoff before next attempt; wait a few seconds — see SCRAPE_JOB_OPTS backoff)'
            : '';
        this.logger.log(
          `[import] step=bull_job_ok importId=${importId} bullState=${state}${delayedHint}`,
        );
        return;
      }
      if (state === 'unknown') {
        this.logger.warn(
          `[import] step=bull_state_unknown importId=${importId} — skip re-enqueue`,
        );
        return;
      }
      if (state === 'failed' || state === 'completed') {
        this.logger.warn(
          `[import] step=bull_remove_stale_job importId=${importId} bullState=${state} — ` +
            (state === 'failed'
              ? 'previous scrape exhausted retries; removing so this importId can be re-queued'
              : 'completed job row blocks same jobId; removing before re-add'),
        );
        await job.remove();
      }
    } else {
      this.logger.warn(
        `[import] step=bull_job_missing importId=${importId} dbStatus=${dbStatus} — Redis has no job for this import`,
      );
    }

    if (dbStatus === ImportStatus.PROCESSING) {
      await this.imports.update(
        { id: importId },
        { status: ImportStatus.QUEUED },
      );
      this.logger.warn(
        `[import] step=db_reset_queued importId=${importId} — was PROCESSING without a live Bull job`,
      );
    }

    const lockOk = await this.redis.acquireScrapeLock(normalizedUrl);
    if (!lockOk) {
      this.logger.warn(
        `[import] step=re_enqueue_wait_lock importId=${importId} — another import holds the URL lock; retry shortly`,
      );
      return;
    }

    try {
      await this.scrapeQueue.add(
        'run',
        { importId },
        {
          jobId: importId,
          ...SCRAPE_JOB_OPTS,
        },
      );
      this.logger.log(
        `[import] step=bull_re_enqueued importId=${importId} queue=${QUEUE_SCRAPE_PRODUCT}`,
      );
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      this.logger.error(
        `[import] step=re_enqueue_failed importId=${importId}: ${msg}`,
        e instanceof Error ? e.stack : undefined,
      );
      await this.redis.releaseScrapeLock(normalizedUrl);
    }
  }

  /**
   * Same URL after COMPLETED → queue another scrape; `upsertProductForImport` refreshes the product row.
   */
  private async startRescrapeForCompletedImport(
    row: ImportedProduct,
    normalizedUrl: string,
  ): Promise<
    | ({
        status: 'queued';
        importId: string;
      } & ReturnType<typeof pendingImportHints>)
    | ({
        status: 'processing';
        importId: string;
      } & ReturnType<typeof pendingImportHints>)
  > {
    await this.redis.invalidateCachedProductUrl(normalizedUrl);
    const job = await this.scrapeQueue.getJob(row.id);
    if (job) {
      const state = await job.getState();
      if (IN_FLIGHT_BULL_STATES.has(state)) {
        this.logger.log(
          `[import] step=rescrape_in_progress importId=${row.id} bullState=${state}`,
        );
        return {
          status: 'processing',
          importId: row.id,
          ...pendingImportHints('scraping'),
        };
      }
      if (state === 'unknown') {
        this.logger.warn(
          `[import] step=rescrape_unknown_bull_state importId=${row.id}`,
        );
        return {
          status: 'processing',
          importId: row.id,
          ...pendingImportHints('queued'),
        };
      }
      if (state === 'failed' || state === 'completed') {
        await job.remove();
      }
    }

    const lockOk = await this.redis.acquireScrapeLock(normalizedUrl);
    if (!lockOk) {
      this.logger.warn(`[import] step=rescrape_lock_busy importId=${row.id}`);
      return {
        status: 'processing',
        importId: row.id,
        ...pendingImportHints('queued'),
      };
    }

    row.status = ImportStatus.QUEUED;
    row.errorMessage = null;
    await this.imports.save(row);

    try {
      await this.scrapeQueue.add(
        'run',
        { importId: row.id },
        { jobId: row.id, ...SCRAPE_JOB_OPTS },
      );
      this.logger.log(
        `[import] step=rescrape_queued importId=${row.id} productId=${row.product?.id}`,
      );
    } catch (e) {
      await this.redis.releaseScrapeLock(normalizedUrl);
      throw e;
    }

    return {
      status: 'queued',
      importId: row.id,
      ...pendingImportHints('queued', 'rescrape'),
    };
  }

  async importByUrl(rawUrl: string) {
    let normalized: string;
    try {
      normalized = normalizeProductUrl(rawUrl);
    } catch {
      throw new BadRequestException('Invalid URL');
    }

    this.logger.log(`[import] step=request url=${previewUrl(normalized)}`);

    const existing = await this.imports.findOne({
      where: { sourceUrl: normalized },
      relations: ['product'],
    });

    if (existing?.status === ImportStatus.COMPLETED) {
      if (!existing.product) {
        const p = await this.productsService.findBySourceUrl(normalized);
        if (p) {
          existing.product = p;
        }
      }
      // Manual (GENERIC) products are not re-scraped; return the existing product directly.
      if (existing.source === ProductSource.GENERIC) {
        return existing.product
          ? {
              status: 'completed' as const,
              product: this.productsService.toResponse(existing.product),
            }
          : { requiresManualEntry: true as const, sourceUrl: normalized };
      }
      return this.startRescrapeForCompletedImport(existing, normalized);
    }

    if (
      existing &&
      (existing.status === ImportStatus.QUEUED ||
        existing.status === ImportStatus.PROCESSING)
    ) {
      this.logger.log(
        `[import] step=already_in_flight importId=${existing.id} status=${existing.status}`,
      );
      await this.ensureScrapeJobInRedis(
        existing.id,
        normalized,
        existing.status,
      );
      const fresh = await this.imports.findOne({ where: { id: existing.id } });
      const phase = importPhaseFromStatus(fresh?.status ?? existing.status)!;
      return {
        status: 'processing' as const,
        importId: existing.id,
        ...pendingImportHints(phase),
      };
    }

    const lockOk = await this.redis.acquireScrapeLock(normalized);
    if (!lockOk && existing) {
      this.logger.log(
        `[import] step=lock_busy_fallback importId=${existing.id}`,
      );
      const phase = importPhaseFromStatus(existing.status)!;
      return {
        status: 'processing' as const,
        importId: existing.id,
        ...pendingImportHints(phase),
      };
    }
    if (!lockOk) {
      throw new ServiceUnavailableException(
        'Another import is in progress for this URL',
      );
    }

    const source = this.scraper.detectSource(normalized);

    if (source === ProductSource.GENERIC) {
      await this.redis.releaseScrapeLock(normalized);
      this.logger.log(
        `[import] step=manual_entry_required url=${previewUrl(normalized)}`,
      );
      return {
        requiresManualEntry: true as const,
        sourceUrl: normalized,
      };
    }

    let importRow =
      existing && existing.status === ImportStatus.FAILED
        ? existing
        : this.imports.create({
            sourceUrl: normalized,
            source,
            status: ImportStatus.QUEUED,
          });
    if (existing && existing.status === ImportStatus.FAILED) {
      importRow.status = ImportStatus.QUEUED;
      importRow.errorMessage = null;
    }

    try {
      importRow = await this.imports.save(importRow);
    } catch (e) {
      if (this.isPostgresUniqueViolation(e)) {
        this.logger.warn(
          `[import] step=duplicate_source_url_race url=${previewUrl(normalized)}`,
        );
        await this.redis.releaseScrapeLock(normalized);
        const winner = await this.imports.findOne({
          where: { sourceUrl: normalized },
          relations: ['product'],
        });
        if (!winner) {
          throw new ServiceUnavailableException(
            'Import conflict; please retry.',
          );
        }
        if (
          winner.status === ImportStatus.QUEUED ||
          winner.status === ImportStatus.PROCESSING
        ) {
          await this.ensureScrapeJobInRedis(
            winner.id,
            normalized,
            winner.status,
          );
          const fresh = await this.imports.findOne({
            where: { id: winner.id },
          });
          const phase = importPhaseFromStatus(fresh?.status ?? winner.status)!;
          return {
            status: 'processing' as const,
            importId: winner.id,
            ...pendingImportHints(phase),
          };
        }
        if (winner.status === ImportStatus.COMPLETED) {
          if (!winner.product) {
            const p = await this.productsService.findBySourceUrl(normalized);
            if (p) {
              winner.product = p;
            }
          }
          return this.startRescrapeForCompletedImport(winner, normalized);
        }
        if (winner.status === ImportStatus.FAILED) {
          return this.importByUrl(rawUrl);
        }
        throw new ServiceUnavailableException('Import conflict; please retry.');
      }
      await this.redis.releaseScrapeLock(normalized);
      throw e;
    }

    try {
      // Remove any stale BullMQ job keyed by the same importId (e.g. a previously
      // exhausted failed job) so that the add() below creates a fresh run.
      // BullMQ silently ignores add() when a job with the same jobId already exists,
      // even in failed/completed state, which would leave the import stuck QUEUED forever.
      const existingBullJob = await this.scrapeQueue.getJob(importRow.id);
      if (existingBullJob) {
        const state = await existingBullJob.getState();
        // Only leave the job alone if it is actively running right now.
        // For every other state (waiting, delayed backoff, failed, completed)
        // remove it so queue.add() below can create a genuinely fresh attempt.
        if (state !== 'active' && state !== 'unknown') {
          this.logger.warn(
            `[import] step=remove_stale_bull_job importId=${importRow.id} bullState=${state}`,
          );
          await existingBullJob.remove();
        }
      }

      this.logger.log(
        `[import] step=queued importId=${importRow.id} source=${source} url=${previewUrl(normalized)}`,
      );

      const bullJob = await this.scrapeQueue.add(
        'run',
        { importId: importRow.id },
        {
          jobId: importRow.id,
          ...SCRAPE_JOB_OPTS,
        },
      );
      this.logger.log(
        `[import] step=bull_enqueued importId=${importRow.id} bullJobId=${String(bullJob.id)} queue=${QUEUE_SCRAPE_PRODUCT} — worker should log worker=picked_job when Redis delivers the job`,
      );

      return {
        status: 'queued' as const,
        importId: importRow.id,
        ...pendingImportHints('queued', 'newJob'),
      };
    } catch (e) {
      await this.redis.releaseScrapeLock(normalized);
      throw e;
    }
  }

  private isPostgresUniqueViolation(err: unknown): boolean {
    return (
      err instanceof QueryFailedError &&
      (err.driverError as { code?: string } | undefined)?.code === '23505'
    );
  }

  /** Same JSON shape as `GET /products/import/:importId` (also used for Socket.IO `import.updated`). */
  buildImportStatusPayload(row: ImportedProduct) {
    const phase = importPhaseFromStatus(row.status);
    return {
      id: row.id,
      status: row.status,
      ...(phase ? pendingImportHints(phase) : {}),
      ...(row.status === ImportStatus.FAILED
        ? {
            /** Safe for clients; internal detail stays in DB only */
            message:
              'We could not import this product. Check the URL or try again later.',
          }
        : {}),
      ...(row.status !== ImportStatus.FAILED && row.product
        ? { product: this.productsService.toResponse(row.product) }
        : {}),
    };
  }

  private async emitImportStatusToSubscribers(importId: string): Promise<void> {
    try {
      const row = await this.imports.findOne({
        where: { id: importId },
        relations: ['product'],
      });
      if (!row) {
        return;
      }
      this.importRealtime.emitImportUpdated(
        importId,
        this.buildImportStatusPayload(row),
      );
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      this.logger.warn(
        `[import] step=socket_emit_skipped importId=${importId}: ${msg}`,
      );
    }
  }

  async getImportStatus(importId: string) {
    let row = await this.imports.findOne({
      where: { id: importId },
      relations: ['product'],
    });
    if (!row) {
      throw new BadRequestException('Import not found');
    }
    if (
      row.status === ImportStatus.QUEUED ||
      row.status === ImportStatus.PROCESSING
    ) {
      await this.ensureScrapeJobInRedis(importId, row.sourceUrl, row.status);
      row =
        (await this.imports.findOne({
          where: { id: importId },
          relations: ['product'],
        })) ?? row;
    }
    return this.buildImportStatusPayload(row);
  }

  async createManualProduct(dto: ManualProductImportDto) {
    let normalized: string;
    try {
      normalized = normalizeProductUrl(dto.sourceUrl);
    } catch {
      throw new BadRequestException('Invalid sourceUrl');
    }

    const existing = await this.imports.findOne({
      where: { sourceUrl: normalized },
      relations: ['product'],
    });

    if (existing?.status === ImportStatus.COMPLETED && existing.product) {
      return {
        status: 'completed' as const,
        product: this.productsService.toResponse(existing.product),
      };
    }

    if (
      existing &&
      (existing.status === ImportStatus.QUEUED ||
        existing.status === ImportStatus.PROCESSING)
    ) {
      throw new ConflictException(
        'An automated import is already in progress for this URL. Please wait for it to finish.',
      );
    }

    const scraped = {
      title: dto.title,
      price: dto.price,
      currency: dto.currency,
      images: dto.imageUrls ?? [],
      description: dto.description,
      brand: dto.brand,
      variants: [],
    };

    let importRow: ImportedProduct;
    if (existing && existing.status === ImportStatus.FAILED) {
      existing.errorMessage = null;
      importRow = existing;
    } else {
      importRow = this.imports.create({
        sourceUrl: normalized,
        source: ProductSource.GENERIC,
        status: ImportStatus.QUEUED,
      });
    }

    try {
      importRow = await this.imports.save(importRow);
    } catch (e) {
      if (this.isPostgresUniqueViolation(e)) {
        throw new ConflictException(
          'A product with this URL already exists or an import is in progress.',
        );
      }
      throw e;
    }

    const product = await this.productsService.upsertProductForImport(
      importRow,
      scraped,
    );

    // Manual products should not be periodically re-scraped.
    await this.productsService.disableRescrape(product.id);
    await this.categoryClassifier.assignCategoryToProduct(product);

    this.logger.log(
      `[import] step=manual_create_done productId=${product.id} url=${previewUrl(normalized)}`,
    );

    return {
      status: 'completed' as const,
      product: this.productsService.toResponse(
        await this.productsService.findById(product.id),
      ),
    };
  }

  /** Called from Bull processor */
  async processScrapeJob(importId: string): Promise<void> {
    const importRow = await this.imports.findOne({
      where: { id: importId },
    });
    if (!importRow) {
      this.logger.warn(
        `[import] step=abort reason=not_found importId=${importId}`,
      );
      return;
    }
    this.logger.log(
      `[import] step=worker_start importId=${importId} source=${importRow.source} url=${previewUrl(importRow.sourceUrl)}`,
    );
    importRow.status = ImportStatus.PROCESSING;
    await this.imports.save(importRow);
    await this.emitImportStatusToSubscribers(importId);
    try {
      this.logger.log(
        `[import] step=scrape importId=${importId} adapter=${importRow.source}`,
      );
      const scraped = await this.scraper.scrape(
        importRow.sourceUrl,
        importRow.source,
      );
      this.logger.log(
        `[import] step=persist importId=${importId} title=${previewText(scraped.title, 60)}`,
      );
      const product = await this.productsService.upsertProductForImport(
        importRow,
        scraped,
      );
      await this.categoryClassifier.assignCategoryToProduct(product);
      await this.redis.setCachedProductId(importRow.sourceUrl, product.id);
      this.logger.log(
        `[import] step=completed importId=${importId} productId=${product.id}`,
      );
      await this.emitImportStatusToSubscribers(importId);
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Scrape failed';
      this.logger.error(
        `[import] step=failed importId=${importId}: ${msg}`,
        e instanceof Error ? e.stack : undefined,
      );
      await this.productsService.markImportFailed(importRow, msg);
      await this.emitImportStatusToSubscribers(importId);
    } finally {
      await this.redis.releaseScrapeLock(importRow.sourceUrl);
    }
  }
}
