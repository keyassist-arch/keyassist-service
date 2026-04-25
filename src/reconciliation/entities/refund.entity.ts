import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { Order } from '../../orders/entities/order.entity';
import { RefundStatus } from '../enums/refund-status.enum';

@Entity('refunds')
export class Refund {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'order_id', type: 'uuid' })
  orderId: string;

  @ManyToOne(() => Order, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'order_id' })
  order: Order;

  /** Amount to refund in the order's currency (e.g. 49.99). */
  @Column({ type: 'decimal', precision: 14, scale: 2 })
  amount: string;

  @Column({ type: 'varchar', length: 8 })
  currency: string;

  @Column({
    type: 'enum',
    enum: RefundStatus,
    default: RefundStatus.PENDING,
  })
  status: RefundStatus;

  /** Reason visible to the customer. */
  @Column({ type: 'varchar', length: 512, nullable: true })
  reason: string | null;

  /** Internal note for staff only. */
  @Column({ name: 'internal_note', type: 'varchar', length: 1024, nullable: true })
  internalNote: string | null;

  /** Provider reference returned on successful refund (e.g. Stripe re_xxx, Paystack ref). */
  @Column({ name: 'provider_refund_id', type: 'varchar', nullable: true })
  providerRefundId: string | null;

  /** Full provider response payload for audit trail. */
  @Column({ name: 'provider_response', type: 'jsonb', nullable: true })
  providerResponse: Record<string, unknown> | null;

  /** ID of the admin user who initiated the refund. */
  @Column({ name: 'initiated_by', type: 'uuid', nullable: true })
  initiatedBy: string | null;

  @Column({ name: 'failed_reason', type: 'varchar', nullable: true })
  failedReason: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
