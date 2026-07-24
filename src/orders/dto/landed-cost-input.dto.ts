import { IsEnum, IsOptional } from 'class-validator';
import type {
  ShippingDestination,
  ShippingService,
} from '../../shipping/utils/kingz-rates';
import {
  PRODUCT_CATEGORIES,
  type ProductCategory,
} from '../../landed-cost/rules/category-weights';

export class LandedCostInputDto {
  @IsEnum(['lagos', 'outside_lagos'] as const)
  destination: ShippingDestination;

  @IsEnum(['air', 'ocean_small'] as const)
  shippingService: ShippingService;

  /**
   * Product category used to estimate package weight and Nigeria customs duty.
   * Defaults to "generic" when omitted.
   */
  @IsEnum(PRODUCT_CATEGORIES)
  @IsOptional()
  category?: ProductCategory;
}
