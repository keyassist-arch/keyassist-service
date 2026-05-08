import { Column, Entity, PrimaryColumn, UpdateDateColumn } from 'typeorm';

/**
 * Single-row config table for Kingz International Logistics rates.
 * Always has exactly one row (id = 1). Update via PATCH /admin/shipping-rates.
 */
@Entity('shipping_rates')
export class ShippingRates {
  @PrimaryColumn({ type: 'int', default: 1 })
  id: number;

  @Column({ name: 'air_rate_lagos_per_lb', type: 'decimal', precision: 10, scale: 2 })
  airRateLagosPerLb: string;

  @Column({ name: 'air_rate_outside_lagos_per_lb', type: 'decimal', precision: 10, scale: 2 })
  airRateOutsideLagosPerLb: string;

  @Column({ name: 'dim_divisor', type: 'int' })
  dimDivisor: number;

  @Column({ name: 'air_minimum_lagos', type: 'decimal', precision: 10, scale: 2 })
  airMinimumLagos: string;

  @Column({ name: 'air_minimum_outside_lagos', type: 'decimal', precision: 10, scale: 2 })
  airMinimumOutsideLagos: string;

  @Column({ name: 'min_weight_lbs', type: 'decimal', precision: 10, scale: 2 })
  minWeightLbs: string;

  @Column({ name: 'bulk_commercial_surcharge', type: 'decimal', precision: 10, scale: 2 })
  bulkCommercialSurcharge: string;

  @Column({ name: 'tv_clearing_fee', type: 'decimal', precision: 10, scale: 2 })
  tvClearingFee: string;

  @Column({ name: 'ocean_small_box_rate', type: 'decimal', precision: 10, scale: 2 })
  oceanSmallBoxRate: string;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
