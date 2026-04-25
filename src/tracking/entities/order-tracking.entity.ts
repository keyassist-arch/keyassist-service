import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { Order } from '../../orders/entities/order.entity';

/**
 * Append-only event log — rows are never updated after insert.
 * DB column was historically `updated_at`; renamed `created_at` to reflect true semantics.
 * Migration: ALTER TABLE order_tracking RENAME COLUMN updated_at TO created_at;
 */
@Entity('order_tracking')
@Index('idx_order_tracking_order_id', ['orderId'])
export class OrderTracking {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'order_id', type: 'uuid' })
  orderId: string;

  @ManyToOne(() => Order, (o) => o.trackingEvents, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'order_id' })
  order: Order;

  /**
   * Nullable so a status-only event (e.g. "Out for delivery") can be recorded
   * without a carrier change.
   */
  @Column({ type: 'varchar', nullable: true })
  carrier: string | null;

  @Column({ name: 'tracking_number', type: 'varchar', nullable: true })
  trackingNumber: string | null;

  /** Lifecycle label: UPDATED | IN_TRANSIT | OUT_FOR_DELIVERY | DELIVERED | EXCEPTION */
  @Column({ type: 'varchar', length: 64 })
  status: string;

  /** Optional human-readable note shown to the customer (e.g. "Arrived at local hub"). */
  @Column({ type: 'varchar', length: 512, nullable: true })
  message: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
