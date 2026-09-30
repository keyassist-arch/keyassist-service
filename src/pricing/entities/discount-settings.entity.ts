import { Column, Entity, PrimaryColumn, UpdateDateColumn } from 'typeorm';

/**
 * Single-row config table for customer discounts.
 * Always has exactly one row (id = 1). Update via PATCH /admin/discount-settings.
 * Every rate defaults to 0, so no discount applies until an admin turns one on.
 */
@Entity('discount_settings')
export class DiscountSettings {
  @PrimaryColumn({ type: 'int', default: 1 })
  id: number;

  /** Fraction (0–1) of the platform service fee taken off a customer's first order. */
  @Column({
    name: 'first_order_discount_rate',
    type: 'decimal',
    precision: 5,
    scale: 4,
    default: 0,
  })
  firstOrderDiscountRate: string;

  /** Fraction (0–1) of the product subtotal taken off once it exceeds the threshold. */
  @Column({
    name: 'volume_discount_rate',
    type: 'decimal',
    precision: 5,
    scale: 4,
    default: 0,
  })
  volumeDiscountRate: string;

  @Column({
    name: 'volume_discount_threshold_usd',
    type: 'decimal',
    precision: 10,
    scale: 2,
    default: 1000,
  })
  volumeDiscountThresholdUsd: string;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
