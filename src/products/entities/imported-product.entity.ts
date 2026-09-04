import { ImportStatus } from '../../common/enums/import-status.enum';
import { ProductSource } from '../../common/enums/product-source.enum';
import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  OneToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { Product } from './product.entity';
import { User } from '../../users/entities/user.entity';
import { Order } from '../../orders/entities/order.entity';

@Entity('imported_products')
export class ImportedProduct {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /** Normalized URL; same string is stored on Product.sourceUrl when linked. */
  @Column({ name: 'source_url', unique: true })
  sourceUrl: string;

  @Column({
    type: 'enum',
    enum: ProductSource,
  })
  source: ProductSource;

  @Column({
    type: 'enum',
    enum: ImportStatus,
    default: ImportStatus.QUEUED,
  })
  status: ImportStatus;

  @OneToOne(() => Product, { nullable: true })
  @JoinColumn({ name: 'product_id' })
  product: Product | null;

  @Column({ type: 'text', name: 'error_message', nullable: true })
  errorMessage: string | null;

  @Column({ type: 'uuid', name: 'requested_by_user_id', nullable: true })
  requestedByUserId: string | null;

  @ManyToOne(() => User, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'requested_by_user_id' })
  requestedByUser: User | null;

  @Column({ type: 'uuid', name: 'order_id', nullable: true })
  orderId: string | null;

  @ManyToOne(() => Order, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'order_id' })
  order: Order | null;

  @Column({ type: 'timestamptz', name: 'dismissed_at', nullable: true })
  dismissedAt: Date | null;

  @Column({ type: 'text', name: 'dismiss_reason', nullable: true })
  dismissReason: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
