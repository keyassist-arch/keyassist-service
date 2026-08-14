import { IsBoolean, IsEnum, IsOptional, IsString } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  PRODUCT_CATEGORIES,
  type ProductCategory,
} from '../rules/category-weights';
import type {
  ShippingDestination,
  ShippingService,
} from '../../shipping/utils/kingz-rates';

/** `POST /landed-cost/quote-cart` — quotes the current user's entire cart, not one line. */
export class LandedCostCartQuoteDto {
  @ApiProperty({ enum: ['lagos', 'outside_lagos'] })
  @IsEnum(['lagos', 'outside_lagos'] as const)
  destination: ShippingDestination;

  @ApiProperty({ enum: ['air', 'ocean_small'] })
  @IsEnum(['air', 'ocean_small'] as const)
  shippingService: ShippingService;

  @ApiPropertyOptional({
    enum: PRODUCT_CATEGORIES,
    description:
      'Product category for weight estimation. Defaults to "generic".',
  })
  @IsEnum(PRODUCT_CATEGORIES)
  @IsOptional()
  category?: ProductCategory;

  @ApiPropertyOptional({
    description:
      'ISO 4217 currency code for the returned total. Defaults to "USD".',
  })
  @IsString()
  @IsOptional()
  displayCurrency?: string;

  @ApiPropertyOptional({
    description:
      'Opt in to Kingz cargo insurance (3% of item cost). Lagos destinations only.',
    default: false,
  })
  @IsBoolean()
  @IsOptional()
  insurance?: boolean;
}
