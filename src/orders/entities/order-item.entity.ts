import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { Order } from './order.entity';
import { Product } from '../../products/entities/product.entity';

@Entity('order_items')
export class OrderItem {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'order_id', type: 'uuid' })
  orderId: string;

  @ManyToOne(() => Order, (o) => o.items, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'order_id' })
  order: Order;

  @Column({ name: 'product_id', type: 'uuid', nullable: true })
  productId: string | null;

  @ManyToOne(() => Product, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'product_id' })
  product: Product | null;

  @Column({ name: 'title_snapshot' })
  titleSnapshot: string;

  @Column({ name: 'price_snapshot', type: 'decimal', precision: 14, scale: 2 })
  priceSnapshot: string;

  @Column({ name: 'currency_snapshot', type: 'varchar', length: 8 })
  currencySnapshot: string;

  @Column()
  quantity: number;

  @Column({ type: 'jsonb', name: 'images_snapshot', default: [] })
  imagesSnapshot: string[];

  @Column({ type: 'jsonb', name: 'variant_snapshot', nullable: true })
  variantSnapshot: Record<string, string> | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
