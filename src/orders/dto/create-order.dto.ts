import { Type } from 'class-transformer';
import {
  IsEnum,
  IsObject,
  IsOptional,
  IsString,
  ValidateNested,
} from 'class-validator';
import type {
  ShippingDestination,
  ShippingService,
} from '../../shipping/utils/kingz-rates';
import {
  PRODUCT_CATEGORIES,
  type ProductCategory,
} from '../../landed-cost/rules/category-weights';

class ShippingAddressDto {
  @IsOptional()
  @IsString()
  fullName?: string;

  @IsString()
  line1: string;

  @IsOptional()
  @IsString()
  line2?: string;

  @IsString()
  city: string;

  @IsOptional()
  @IsString()
  state?: string;

  @IsString()
  country: string;

  @IsOptional()
  @IsString()
  postalCode?: string;

  @IsOptional()
  @IsString()
  phone?: string;
}

class LandedCostInputDto {
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

export class CreateOrderDto {
  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => ShippingAddressDto)
  shippingAddress?: ShippingAddressDto;

  @IsObject()
  @ValidateNested()
  @Type(() => LandedCostInputDto)
  landedCost: LandedCostInputDto;
}
