import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { MoreThan, Repository } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';
import {
  Product,
  ProductConfigurationPrice,
  ProductVariant,
} from './entities/product.entity';
import { ImportedProduct } from './entities/imported-product.entity';
import { ProductSource } from '../common/enums/product-source.enum';
import { ImportStatus } from '../common/enums/import-status.enum';
import { ScrapedProduct } from '../scraper/interfaces/scraped-product.interface';
import { parsePriceToDecimalString } from '../scraper/utils/normalize-price.util';
import { slugifyTitle } from '../common/utils/slugify.util';
import { CurrencyService } from '../currency/currency.service';
import { AdminCreateProductDto } from './dto/admin-create-product.dto';
import { AdminUpdateProductDto } from './dto/admin-update-product.dto';

@Injectable()
export class ProductsService {
  private readonly logger = new Logger(ProductsService.name);

  constructor(
    @InjectRepository(Product)
    private readonly products: Repository<Product>,
    @InjectRepository(ImportedProduct)
    private readonly imports: Repository<ImportedProduct>,
    private readonly config: ConfigService,
    private readonly currency: CurrencyService,
  ) {}

  private defaultMarkup(): string {
    const pct = this.config.get<number>('DEFAULT_MARKUP_PERCENT', 10);
    return Number(pct).toFixed(2);
  }

  private salePrice(original: string, markupPercent: string): string {
    void markupPercent;
    return parsePriceToDecimalString(original) ?? '0.00';
  }

  /**
   * TypeORM jsonb change detection can miss in-place updates; assign fresh arrays/objects
   * so rescrapes always persist new images and variant matrices.
   */
  private applyScrapedJsonColumns(
    entity: Product,
    data: Partial<Product>,
  ): void {
    entity.images = [...(data.images ?? [])];
    entity.variants = JSON.parse(
      JSON.stringify(data.variants ?? []),
    ) as ProductVariant[];
    entity.configurationPrices = JSON.parse(
      JSON.stringify(data.configurationPrices ?? []),
    ) as ProductConfigurationPrice[];
  }

  async buildProductFromScrape(
    url: string,
    source: ProductSource,
    scraped: ScrapedProduct,
    markupPercent?: string,
  ): Promise<Partial<Product>> {
    const sourceCurrency = (scraped.currency || 'USD').toUpperCase();
    const rawOrig = parsePriceToDecimalString(scraped.price) ?? '0';

    const orig = await this.toUsd(parseFloat(rawOrig), sourceCurrency);

    const configurationPrices = await this.convertConfigPricesToUsd(
      scraped.configurationPrices ?? [],
      sourceCurrency,
    );

    const markup = '0.00';
    const descParts: string[] = [];
    if (scraped.description?.trim()) {
      descParts.push(scraped.description.trim());
    }
    if (scraped.configurationSummaries?.length) {
      descParts.push(
        'Configurations:\n' + scraped.configurationSummaries.join('\n'),
      );
    }
    const description = descParts.length ? descParts.join('\n\n') : null;
    return {
      sourceUrl: url,
      source,
      title: scraped.title,
      description,
      brand: scraped.brand ?? null,
      originalPrice: orig,
      currency: 'USD',
      markupPercent: markup,
      salePrice: this.salePrice(orig, markup),
      images: scraped.images ?? [],
      variants: scraped.variants ?? [],
      configurationPrices,
      availability: scraped.availability ?? null,
      compareAtPrice: scraped.compareAtPrice
        ? (parsePriceToDecimalString(scraped.compareAtPrice) ?? null)
        : null,
      discount: scraped.discount ?? null,
      savingsAmount: scraped.savingsAmount ?? null,
      dealType: scraped.dealType ?? null,
      asin: scraped.asin ?? null,
      metadata: scraped.metadata ?? null,
      observedTaxAmountUsd:
        scraped.taxAmountUsd != null ? scraped.taxAmountUsd.toFixed(2) : null,
      lastScrapedAt: new Date(),
      lastVerifiedAt: new Date(),
    };
  }

  private async toUsd(amount: number, fromCurrency: string): Promise<string> {
    if (fromCurrency === 'USD') return amount.toFixed(2);
    try {
      const usd = await this.currency.convert(amount, fromCurrency, 'USD');
      return usd.toFixed(2);
    } catch (err) {
      this.logger.warn(
        `[product] usd_conversion_failed from=${fromCurrency} amount=${amount} — storing original: ${(err as Error).message}`,
      );
      return amount.toFixed(2);
    }
  }

  private async convertConfigPricesToUsd(
    rows: ProductConfigurationPrice[],
    productCurrency: string,
  ): Promise<ProductConfigurationPrice[]> {
    return Promise.all(
      rows.map(async (row) => {
        const rowCurrency = (row.currency || productCurrency).toUpperCase();
        const converted = await this.toUsd(
          parseFloat(row.originalPrice),
          rowCurrency,
        );
        return { ...row, originalPrice: converted, currency: 'USD' };
      }),
    );
  }

  /**
   * Unique slug for URLs (`/products/{slug}`). Excludes `productId` from collision checks on update.
   *
   * Uses a single bulk query to fetch all clashing slugs, then picks the first
   * available suffix in memory — avoids N sequential DB round-trips.
   */
  async allocateUniqueSlug(title: string, productId?: string): Promise<string> {
    const base = slugifyTitle(title);

    const qb = this.products
      .createQueryBuilder('p')
      .select('p.slug', 'slug')
      .where('p.slug = :base OR p.slug LIKE :pattern', {
        base,
        pattern: `${base}-%`,
      });
    if (productId) {
      qb.andWhere('p.id != :productId', { productId });
    }

    const rows = await qb.getRawMany<{ slug: string }>();
    const taken = new Set(rows.map((r) => r.slug));

    if (!taken.has(base)) return base;

    // Find the first available numeric suffix.
    for (let n = 2; n <= taken.size + 2; n++) {
      const candidate = `${base}-${n}`;
      if (!taken.has(candidate)) return candidate;
    }

    // Fallback — practically unreachable.
    return `${base}-${Date.now()}`;
  }

  async upsertProductForImport(
    importRow: ImportedProduct,
    scraped: ScrapedProduct,
  ): Promise<Product> {
    const existing = await this.products.findOne({
      where: { sourceUrl: importRow.sourceUrl },
    });
    const data = await this.buildProductFromScrape(
      importRow.sourceUrl,
      importRow.source,
      scraped,
      existing?.markupPercent,
    );
    data.slug = await this.allocateUniqueSlug(scraped.title, existing?.id);
    let product: Product;
    if (existing) {
      Object.assign(existing, data);
      this.applyScrapedJsonColumns(existing, data);
      product = await this.products.save(existing);
    } else {
      const created = this.products.create(data as Product);
      this.applyScrapedJsonColumns(created, data);
      product = await this.products.save(created);
    }
    importRow.product = product;
    importRow.status = ImportStatus.COMPLETED;
    importRow.errorMessage = null;
    await this.imports.save(importRow);
    return product;
  }

  async markImportFailed(importRow: ImportedProduct, message: string) {
    importRow.status = ImportStatus.FAILED;
    importRow.errorMessage = message;
    /** Last attempt failed — do not keep a stale FK; product row may still exist by `sourceUrl` */
    importRow.product = null;
    await this.imports.save(importRow);
  }

  /**
   * Admin-authored product, no scrape involved. `sourceUrl` is synthesized since the column is
   * NOT NULL + unique — hand-entered products aren't tied to a retailer URL to rescrape.
   */
  async createManual(dto: AdminCreateProductDto): Promise<Product> {
    const slug = await this.allocateUniqueSlug(dto.title);
    const originalPrice = dto.originalPrice.toFixed(2);
    const markupPercent = '0.00';
    const product = this.products.create({
      sourceUrl: `internal://admin/${randomUUID()}`,
      source: ProductSource.KEYASSIST,
      title: dto.title,
      slug,
      description: dto.description ?? null,
      brand: dto.brand ?? null,
      originalPrice,
      currency: 'USD',
      markupPercent,
      salePrice: this.salePrice(originalPrice, markupPercent),
      images: dto.images ?? [],
      variants: (dto.variants ?? []) as ProductVariant[],
      configurationPrices: (dto.configurationPrices ?? []) as ProductConfigurationPrice[],
      availability: dto.availability ?? null,
      compareAtPrice:
        dto.compareAtPrice != null ? dto.compareAtPrice.toFixed(2) : null,
      stockQuantity: dto.stockQuantity ?? null,
      categoryId: dto.categoryId ?? null,
      rescrapeEnabled: false,
      lastScrapedAt: null,
      lastVerifiedAt: null,
    });
    return this.products.save(product);
  }

  async updateManual(id: string, dto: AdminUpdateProductDto): Promise<Product> {
    const product = await this.findById(id);

    if (dto.title !== undefined && dto.title !== product.title) {
      product.title = dto.title;
      product.slug = await this.allocateUniqueSlug(dto.title, product.id);
    }
    if (dto.description !== undefined) product.description = dto.description ?? null;
    if (dto.brand !== undefined) product.brand = dto.brand ?? null;
    if (dto.originalPrice !== undefined) {
      const originalPrice = dto.originalPrice.toFixed(2);
      product.originalPrice = originalPrice;
      product.salePrice = this.salePrice(originalPrice, product.markupPercent);
    }
    if (dto.images !== undefined) product.images = [...dto.images];
    if (dto.variants !== undefined) {
      product.variants = JSON.parse(JSON.stringify(dto.variants)) as ProductVariant[];
    }
    if (dto.configurationPrices !== undefined) {
      product.configurationPrices = JSON.parse(
        JSON.stringify(dto.configurationPrices),
      ) as ProductConfigurationPrice[];
    }
    if (dto.stockQuantity !== undefined) product.stockQuantity = dto.stockQuantity ?? null;
    if (dto.categoryId !== undefined) product.categoryId = dto.categoryId ?? null;
    if (dto.availability !== undefined) product.availability = dto.availability ?? null;
    if (dto.compareAtPrice !== undefined) {
      product.compareAtPrice =
        dto.compareAtPrice != null ? dto.compareAtPrice.toFixed(2) : null;
    }

    return this.products.save(product);
  }

  async findById(id: string): Promise<Product> {
    const p = await this.products.findOne({ where: { id } });
    if (!p) {
      throw new NotFoundException('Product not found');
    }
    return p;
  }

  /** `param` is either a UUID (legacy links) or the unique `slug` (readable URLs). */
  async findByIdOrSlug(param: string): Promise<Product> {
    if (isUuidParam(param)) {
      return this.findById(param);
    }
    const p = await this.products.findOne({ where: { slug: param } });
    if (!p) {
      throw new NotFoundException('Product not found');
    }
    return p;
  }

  async findBySourceUrl(url: string): Promise<Product | null> {
    return this.products.findOne({ where: { sourceUrl: url } });
  }

  async disableRescrape(id: string): Promise<void> {
    await this.products.update({ id }, { rescrapeEnabled: false });
  }

  async updateObservedTax(id: string, taxAmountUsd: number): Promise<void> {
    await this.products.update({ id }, { observedTaxAmountUsd: taxAmountUsd.toFixed(2) });
  }

  async remove(id: string): Promise<void> {
    const product = await this.findById(id);
    await this.imports.update(
      { product: { id: product.id } },
      { product: null },
    );
    await this.products.remove(product);
    this.logger.log(`[product] step=deleted productId=${id}`);
  }

  async findAllForAdmin(): Promise<Product[]> {
    return this.products.find({
      order: { createdAt: 'DESC' },
      take: 500,
    });
  }

  /**
   * Public catalog snippet (e.g. home page); `limit` should be pre-clamped by the controller.
   * Unpriced rows (`salePrice` 0) are customer manual-entry requests still waiting on an admin
   * quote — they stay out of the storefront feed but remain reachable by direct link and in
   * `GET /admin/products`.
   */
  async findRecentForPublic(limit: number): Promise<Product[]> {
    return this.products.find({
      where: { salePrice: MoreThan('0') },
      order: { createdAt: 'DESC' },
      take: limit,
    });
  }

  /**
   * Related products for a product detail page.
   * Returns same-category products first, then title-keyword matches to fill the remainder.
   * The source product is always excluded from results.
   */
  async findRelated(param: string, limit: number): Promise<ReturnType<ProductsService['toResponse']>[]> {
    const product = await this.findByIdOrSlug(param);
    const results: Product[] = [];
    const seen = new Set<string>([product.id]);

    // 1. Same-category products (highest relevance)
    if (product.categoryId) {
      const sameCat = await this.products.find({
        where: { categoryId: product.categoryId, salePrice: MoreThan('0') },
        order: { createdAt: 'DESC' },
        take: limit,
      });
      for (const p of sameCat) {
        if (!seen.has(p.id)) {
          seen.add(p.id);
          results.push(p);
        }
      }
    }

    // 2. Title keyword matches to fill any remainder
    if (results.length < limit) {
      const keywords = this.extractTitleKeywords(product.title);
      if (keywords.length > 0) {
        const kwConditions = keywords.map((_, i) => `p.title ILIKE :kw${i}`);
        const kwParams: Record<string, string> = {};
        keywords.forEach((kw, i) => { kwParams[`kw${i}`] = `%${kw}%`; });

        const nameMatches = await this.products
          .createQueryBuilder('p')
          .where('p.id != :id', { id: product.id })
          .andWhere('p.sale_price > 0')
          .andWhere(`(${kwConditions.join(' OR ')})`, kwParams)
          .orderBy('p.created_at', 'DESC')
          .take(limit)
          .getMany();

        for (const p of nameMatches) {
          if (!seen.has(p.id) && results.length < limit) {
            seen.add(p.id);
            results.push(p);
          }
        }
      }
    }

    return results.slice(0, limit).map((p) => this.toResponse(p));
  }

  private extractTitleKeywords(title: string): string[] {
    const stopWords = new Set([
      'the', 'and', 'for', 'with', 'from', 'this', 'that', 'are', 'was',
      'has', 'have', 'will', 'can', 'not', 'but', 'its', 'new', 'all',
    ]);
    return title
      .split(/[\s\-_,./|&()\[\]]+/)
      .map((w) => w.replace(/[^a-z0-9]/gi, '').toLowerCase())
      .filter((w) => w.length > 3 && !stopWords.has(w))
      .slice(0, 3);
  }

  /**
   * Products due for a periodic rescrape: enabled, and never scraped or last scrape before `cutoff`.
   * Use from a cron job with e.g. `cutoff = subHours(new Date(), 24)`.
   */
  async findCandidatesForRescrape(
    cutoff: Date,
    limit = 500,
  ): Promise<Product[]> {
    return this.products
      .createQueryBuilder('p')
      .where('p.rescrape_enabled = :enabled', { enabled: true })
      .andWhere('(p.last_scraped_at IS NULL OR p.last_scraped_at < :cutoff)', {
        cutoff,
      })
      .orderBy('p.last_scraped_at', 'ASC')
      .addOrderBy('p.created_at', 'ASC')
      .take(limit)
      .getMany();
  }

  /**
   * Apply a full scrape result to an existing product (prices, title, media, availability).
   * Preserves `sourceUrl`, `source`, and `markupPercent`. Updates `lastScrapedAt` / `lastVerifiedAt`.
   */
  async applyRescrapeFromData(
    productId: string,
    scraped: ScrapedProduct,
  ): Promise<Product> {
    this.logger.log(
      `[product] step=rescrape_apply_begin productId=${productId}`,
    );
    const product = await this.findById(productId);
    const patch = await this.buildProductFromScrape(
      product.sourceUrl,
      product.source,
      scraped,
      product.markupPercent,
    );
    // Only reallocate the slug when the title has actually changed — saves a DB query on every rescrape.
    const titleChanged =
      scraped.title.trim().toLowerCase() !== product.title.trim().toLowerCase();
    patch.slug = titleChanged
      ? await this.allocateUniqueSlug(scraped.title, product.id)
      : product.slug;
    Object.assign(product, patch);
    this.applyScrapedJsonColumns(product, patch);
    const saved = await this.products.save(product);
    this.logger.log(
      `[product] step=rescrape_apply_done productId=${productId} salePrice=${saved.salePrice}`,
    );
    return saved;
  }

  /**
   * Apply a scrape result to an existing row (checkout refresh, delayed verify job).
   * Updates catalog fields the same way as import rescrape so JSON columns and copy stay in sync.
   */
  async refreshPriceFromScrape(product: Product, scraped: ScrapedProduct) {
    const patch = await this.buildProductFromScrape(
      product.sourceUrl,
      product.source,
      scraped,
      product.markupPercent,
    );
    const titleChanged =
      scraped.title.trim().toLowerCase() !== product.title.trim().toLowerCase();
    patch.slug = titleChanged
      ? await this.allocateUniqueSlug(scraped.title, product.id)
      : product.slug;
    Object.assign(product, patch);
    this.applyScrapedJsonColumns(product, patch);
    return this.products.save(product);
  }

  /**
   * Finds the `configurationPrices` row that matches the given variant selection.
   * Multi-axis (variantSelections) takes priority; single-axis (variantAxis+optionValue) is fallback.
   */
  resolveVariantRow(
    product: Product,
    variantSelection: Record<string, string>,
  ): ProductConfigurationPrice | null {
    const rows = product.configurationPrices ?? [];
    const entries = Object.entries(variantSelection);
    if (!entries.length || !rows.length) return null;

    for (const row of rows) {
      if (row.variantSelections) {
        if (entries.every(([axis, value]) => row.variantSelections![axis] === value)) {
          return row;
        }
      }
    }

    if (entries.length === 1) {
      const [axis, value] = entries[0];
      for (const row of rows) {
        if (row.variantAxis === axis && row.optionValue === value) return row;
      }
    }

    return null;
  }

  /**
   * Returns the correct unit sale price (markup applied) for a product given the buyer's
   * variant selection. Falls back to `salePrice` when there is no match or no selection.
   */
  resolveVariantPrice(
    product: Product,
    variantSelection?: Record<string, string> | null,
  ): string {
    if (!variantSelection || !Object.keys(variantSelection).length) {
      return product.salePrice;
    }
    const row = this.resolveVariantRow(product, variantSelection);
    if (!row) return product.salePrice;
    return this.salePrice(row.originalPrice, product.markupPercent);
  }

  toResponse(p: Product) {
    const variantOptions: Record<string, string[]> = {};
    for (const v of p.variants ?? []) {
      variantOptions[v.name] = v.options;
    }
    return {
      id: p.id,
      slug: p.slug ?? p.id,
      /** Canonical URL used for scraping / rescrapes (same as `sourceUrl`). */
      scrapeUrl: p.sourceUrl,
      sourceUrl: p.sourceUrl,
      rescrapeEnabled: p.rescrapeEnabled,
      source: p.source,
      title: p.title,
      description: p.description,
      brand: p.brand,
      asin: p.asin ?? null,
      originalPrice: p.originalPrice,
      salePrice: p.salePrice,
      /**
       * `true` when no price is known yet — a customer manual-entry request the admin has not
       * quoted. Render "Price on request" rather than the 0.00 in `salePrice`.
       */
      awaitingQuote: parseFloat(p.salePrice) <= 0,
      currency: p.currency,
      markupPercent: p.markupPercent,
      images: p.images,
      /**
       * Ordered variant axes — use this array to preserve axis display order (e.g. Storage before Color on Apple,
       * Size before Width on Nike). Keys match `configurationPrices[].variantSelections`.
       */
      variants: p.variants ?? [],
      /**
       * Variant axes and their options as a map, e.g. `{ Color: ["Black", "White"], Storage: ["128 GB", "256 GB"] }`.
       * Use `configurationPrices[].variantSelections` to look up the price for the active combination.
       */
      variantOptions,
      configurationPrices: (p.configurationPrices ?? []).map((row) => {
        // Derive variantSelections from single-axis fields when not already set (GOAT, Zara, Converse, etc.).
        const variantSelections: Record<string, string> | undefined =
          row.variantSelections ??
          (row.variantAxis && row.optionValue
            ? { [row.variantAxis]: row.optionValue }
            : undefined);
        return {
          label: row.label,
          originalPrice: row.originalPrice,
          // Apply the same markup as the main product so per-variant prices stay consistent.
          salePrice: this.salePrice(row.originalPrice, p.markupPercent),
          partNumber: row.partNumber,
          sku: row.sku,
          variantAxis: row.variantAxis,
          optionValue: row.optionValue,
          variantSelections,
          currency: row.currency ?? p.currency,
          available: row.available,
          displayLabel: row.displayLabel,
          metadata: row.metadata,
        };
      }),
      availability: p.availability,
      compareAtPrice: p.compareAtPrice ?? null,
      discount: p.discount ?? null,
      savingsAmount: p.savingsAmount ?? null,
      dealType: p.dealType ?? null,
      metadata: p.metadata ?? null,
      stockQuantity: p.stockQuantity,
      categoryId: p.categoryId ?? null,
      lastScrapedAt: p.lastScrapedAt,
      lastVerifiedAt: p.lastVerifiedAt,
    };
  }
}

function isUuidParam(s: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    s,
  );
}
