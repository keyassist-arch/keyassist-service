import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { User } from '../../users/entities/user.entity';
import { Batch } from './batch.entity';
import { ProductSource } from '../../common/enums/product-source.enum';
import { WannaBuyItemStatus } from '../../common/enums/wanna-buy-item-status.enum';

@Entity('wanna_buy_items')
export class WannaBuyItem {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'user_id', type: 'uuid' })
  userId: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user: User;

  @Column({ name: 'batch_id', type: 'uuid', nullable: true })
  batchId: string | null;

  @ManyToOne(() => Batch, (b) => b.items, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'batch_id' })
  batch: Batch | null;

  @Column({ name: 'product_url', type: 'varchar', length: 2048 })
  productUrl: string;

  @Column({ name: 'product_title', type: 'varchar', length: 512, nullable: true })
  productTitle: string | null;

  @Column({ name: 'image_url', type: 'varchar', length: 2048, nullable: true })
  imageUrl: string | null;

  @Column({ type: 'enum', enum: ProductSource, nullable: true })
  marketplace: ProductSource | null;

  @Column({ name: 'variant_selection', type: 'jsonb', nullable: true })
  variantSelection: Record<string, string> | null;

  @Column({
    type: 'enum',
    enum: WannaBuyItemStatus,
    default: WannaBuyItemStatus.PENDING,
  })
  status: WannaBuyItemStatus;

  /** Price captured by the scraper at the time of submission */
  @Column({ name: 'scraped_price_usd', type: 'decimal', precision: 14, scale: 2, nullable: true })
  scrapedPriceUsd: string | null;

  /** Admin-edited price override (takes precedence over scraped price) */
  @Column({ name: 'admin_price_usd', type: 'decimal', precision: 14, scale: 2, nullable: true })
  adminPriceUsd: string | null;

  @Column({ name: 'price_edit_note', type: 'varchar', length: 512, nullable: true })
  priceEditNote: string | null;

  /** Actual marketplace tax entered by the team */
  @Column({ name: 'tax_amount_usd', type: 'decimal', precision: 14, scale: 2, nullable: true })
  taxAmountUsd: string | null;

  /** Platform service fee: $6 flat if price ≤ $100, else 10% of price */
  @Column({ name: 'platform_fee_usd', type: 'decimal', precision: 14, scale: 2, nullable: true })
  platformFeeUsd: string | null;

  /** Kingz international shipping cost (USA → Nigeria) */
  @Column({ name: 'kingz_shipping_usd', type: 'decimal', precision: 14, scale: 2, nullable: true })
  kingzShippingUsd: string | null;

  @Column({ name: 'fx_buffer_usd', type: 'decimal', precision: 14, scale: 2, nullable: true })
  fxBufferUsd: string | null;

  @Column({ name: 'total_usd', type: 'decimal', precision: 14, scale: 2, nullable: true })
  totalUsd: string | null;

  @Column({ name: 'total_ngn', type: 'decimal', precision: 18, scale: 2, nullable: true })
  totalNgn: string | null;

  @Column({ name: 'notified_at', type: 'timestamptz', nullable: true })
  notifiedAt: Date | null;

  @Column({ name: 'confirmed_at', type: 'timestamptz', nullable: true })
  confirmedAt: Date | null;

  @Column({ name: 'paid_at', type: 'timestamptz', nullable: true })
  paidAt: Date | null;

  /** The Order created when the user pays for this item. */
  @Column({ name: 'order_id', type: 'uuid', nullable: true })
  orderId: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
