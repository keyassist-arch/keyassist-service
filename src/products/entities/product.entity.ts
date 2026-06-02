import { ProductSource } from '../../common/enums/product-source.enum';
import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  OneToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { ImportedProduct } from './imported-product.entity';

export type ProductVariant = { name: string; options: string[] };

/**
 * Per-option supplier prices (Apple SKUs, GOAT per-size asks, Zara color rows, etc.).
 * Use `variantSelections` (multi-axis) or `variantAxis`+`optionValue` (single-axis legacy) to build
 * selectors like the retailer PDP; `displayLabel` is optional shop copy.
 */
export type ProductConfigurationPrice = {
  label: string;
  originalPrice: string;
  partNumber?: string;
  sku?: string;
  /** Variant dimension this row belongs to (e.g. `Size`, `Color`, `Width`). */
  variantAxis?: string;
  /** Stable value for that axis — matches an entry in `Product.variants[].options` when both are set. */
  optionValue?: string;
  /**
   * Multi-axis variant key for this price row, e.g. `{ Storage: "256 GB", Color: "Black Titanium" }`.
   * Keys match entries in `variantOptions`; use this to look up the active price when the customer
   * has selected values on multiple axes (storage × color, etc.).
   */
  variantSelections?: Record<string, string>;
  /** Per-row currency when it differs from product `currency` (usually omitted). */
  currency?: string;
  /** `false` = show disabled / OOS in UI. */
  available?: boolean;
  /** Human-readable line (e.g. `9.5 — from USD 425.00`); omit to build from option + prices in the client. */
  displayLabel?: string;
  /** Store-specific fields (condition, retailer ids, etc.). */
  metadata?: Record<string, unknown>;
};

@Entity('products')
@Index('idx_products_rescrape', ['rescrapeEnabled', 'lastScrapedAt'])
export class Product {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /**
   * Normalized canonical URL used for Playwright scrapes and periodic rescrapes (cron).
   * Always kept in sync on import upsert; unique for deduplication.
   */
  @Column({ name: 'source_url', unique: true })
  sourceUrl: string;

  @Column({
    type: 'enum',
    enum: ProductSource,
  })
  source: ProductSource;

  @Column()
  title: string;

  /**
   * Human-readable path segment for storefront URLs (`/products/{slug}`).
   * Nullable in the schema so dev `synchronize` can add the column to non-empty tables;
   * `ProductSlugBackfillService` and imports always fill it (legacy rows: `id::text`).
   */
  @Column({ type: 'varchar', length: 200, unique: true, nullable: true })
  slug: string | null;

  @Column({ type: 'text', nullable: true })
  description: string | null;

  @Column({ type: 'varchar', nullable: true })
  brand: string | null;

  @Column({ type: 'decimal', precision: 14, scale: 2, name: 'original_price' })
  originalPrice: string;

  @Column({ type: 'varchar', length: 8 })
  currency: string;

  @Column({
    type: 'decimal',
    precision: 5,
    scale: 2,
    name: 'markup_percent',
    default: '10',
  })
  markupPercent: string;

  @Column({ type: 'decimal', precision: 14, scale: 2, name: 'sale_price' })
  salePrice: string;

  @Column({ type: 'jsonb', default: [] })
  images: string[];

  @Column({ type: 'jsonb', default: [] })
  variants: ProductVariant[];

  /**
   * Retailer list price per hardware configuration when the scraper provides it (e.g. Apple metrics).
   * Does not include carrier-specific promo rows; use for PDP price tables — main `originalPrice` is still the selected config.
   */
  @Column({ name: 'configuration_prices', type: 'jsonb', default: [] })
  configurationPrices: ProductConfigurationPrice[];

  /** Retailer "was" / list price when the PDP shows a markdown (e.g. eBay strike price). */
  @Column({ name: 'compare_at_price', type: 'decimal', precision: 14, scale: 2, nullable: true })
  compareAtPrice: string | null;

  /** Savings percentage badge text, e.g. "-40%" or "60% off". */
  @Column({ type: 'varchar', length: 50, nullable: true })
  discount: string | null;

  /** Absolute savings amount as a decimal string, e.g. "1020.00". */
  @Column({ name: 'savings_amount', type: 'decimal', precision: 14, scale: 2, nullable: true })
  savingsAmount: string | null;

  /** Promotional label, e.g. "Limited-time deal" or "Lightning Deal". */
  @Column({ name: 'deal_type', type: 'varchar', length: 100, nullable: true })
  dealType: string | null;

  /**
   * Marketplace-specific product identifier (e.g. Amazon ASIN, Nike styleColor).
   * Populated from `ScrapedProduct.asin`; null when the adapter does not set it.
   */
  @Column({ type: 'varchar', length: 100, nullable: true })
  asin: string | null;

  /** Adapter-specific extra data (e.g. Apple carrier→URL routing map). */
  @Column({ type: 'jsonb', nullable: true })
  metadata: Record<string, unknown> | null;

  @Column({ type: 'varchar', nullable: true })
  availability: string | null;

  /**
   * When set, stock is enforced at checkout and reduced when the order is paid.
   * When null, product is treated as unlimited (dropship / external fulfilment).
   */
  @Column({ name: 'stock_quantity', type: 'int', nullable: true })
  stockQuantity: number | null;

  /** FK to the `categories` table. Null = uncategorised. */
  @Column({ type: 'uuid', nullable: true, name: 'category_id' })
  categoryId: string | null;

  @Column({ name: 'last_scraped_at', type: 'timestamptz', nullable: true })
  lastScrapedAt: Date | null;

  @Column({ name: 'last_verified_at', type: 'timestamptz', nullable: true })
  lastVerifiedAt: Date | null;

  /**
   * When false, periodic rescrape jobs should skip this row (e.g. manual-only catalog items).
   */
  @Column({ name: 'rescrape_enabled', type: 'boolean', default: true })
  rescrapeEnabled: boolean;

  @OneToOne(() => ImportedProduct, (i) => i.product)
  importRecord: ImportedProduct;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
