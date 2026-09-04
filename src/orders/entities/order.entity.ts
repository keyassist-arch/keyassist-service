import { OrderStatus } from '../../common/enums/order-status.enum';
import { User } from '../../users/entities/user.entity';
import type { ShippingAddress } from '../../users/entities/user.entity';
import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { OrderItem } from './order-item.entity';
import { OrderTracking } from '../../tracking/entities/order-tracking.entity';

@Entity('orders')
export class Order {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'user_id', type: 'uuid' })
  userId: string;

  @ManyToOne(() => User, (u) => u.orders, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user: User;

  @Column({
    type: 'enum',
    enum: OrderStatus,
    default: OrderStatus.PENDING,
  })
  status: OrderStatus;

  @Column({ type: 'decimal', precision: 14, scale: 2 })
  subtotal: string;

  @Column({ type: 'decimal', precision: 14, scale: 2, default: '0' })
  fees: string;

  @Column({ type: 'decimal', precision: 14, scale: 2, default: '0' })
  discount: string;

  @Column({
    name: 'shipping_fee',
    type: 'decimal',
    precision: 14,
    scale: 2,
    default: '0',
  })
  shippingFee: string;

  @Column({
    name: 'marketplace_tax',
    type: 'decimal',
    precision: 14,
    scale: 2,
    default: '0',
  })
  marketplaceTax: string;

  /** Shipping cost from the source marketplace to our warehouse (estimated per marketplace rules) */
  @Column({
    name: 'marketplace_shipping',
    type: 'decimal',
    precision: 14,
    scale: 2,
    default: '0',
  })
  marketplaceShipping: string;

  @Column({
    name: 'domestic_handling',
    type: 'decimal',
    precision: 14,
    scale: 2,
    default: '0',
  })
  domesticHandling: string;

  @Column({
    name: 'customs_total',
    type: 'decimal',
    precision: 14,
    scale: 2,
    default: '0',
  })
  customsTotal: string;

  /** Optional Kingz cargo insurance (3% of item cost). 0 unless the customer opted in. */
  @Column({
    name: 'insurance',
    type: 'decimal',
    precision: 14,
    scale: 2,
    default: '0',
  })
  insurance: string;

  @Column({
    name: 'fx_buffer',
    type: 'decimal',
    precision: 14,
    scale: 2,
    default: '0',
  })
  fxBuffer: string;

  @Column({
    name: 'risk_buffer',
    type: 'decimal',
    precision: 14,
    scale: 2,
    default: '0',
  })
  riskBuffer: string;

  @Column({
    name: 'pricing_breakdown',
    type: 'jsonb',
    default: [],
  })
  pricingBreakdown: string[];

  @Column({ type: 'decimal', precision: 14, scale: 2 })
  total: string;

  @Column({ type: 'varchar', length: 8 })
  currency: string;

  @Column({ type: 'jsonb', name: 'shipping_address' })
  shippingAddress: ShippingAddress;

  @Column({ name: 'paystack_reference', type: 'varchar', nullable: true })
  paystackReference: string | null;

  @Column({
    name: 'payment_provider',
    type: 'varchar',
    length: 32,
    nullable: true,
  })
  paymentProvider: string | null;

  @Column({
    name: 'stripe_checkout_session_id',
    type: 'varchar',
    nullable: true,
  })
  stripeCheckoutSessionId: string | null;

  @Column({
    name: 'stripe_payment_intent_id',
    type: 'varchar',
    nullable: true,
  })
  stripePaymentIntentId: string | null;

  @Column({ type: 'jsonb', name: 'payment_method_details', nullable: true })
  paymentMethodDetails: Record<string, unknown> | null;

  @Column({ name: 'supplier_order_id', type: 'varchar', nullable: true })
  supplierOrderId: string | null;

  @Column({ name: 'tracking_number', type: 'varchar', nullable: true })
  trackingNumber: string | null;

  @Column({ type: 'varchar', nullable: true })
  carrier: string | null;

  @OneToMany(() => OrderItem, (i) => i.order, { cascade: true })
  items: OrderItem[];

  @OneToMany(() => OrderTracking, (t) => t.order, { cascade: true })
  trackingEvents: OrderTracking[];

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
