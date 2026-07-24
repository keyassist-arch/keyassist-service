import {
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ProductSource } from '../../common/enums/product-source.enum';
import {
  PRODUCT_CATEGORIES,
  type ProductCategory,
} from '../rules/category-weights';
import type {
  ShippingDestination,
  ShippingService,
} from '../../shipping/utils/kingz-rates';

class DimensionsDto {
  @IsNumber()
  @Min(0)
  lengthIn: number;

  @IsNumber()
  @Min(0)
  widthIn: number;

  @IsNumber()
  @Min(0)
  heightIn: number;
}

export class LandedCostQuoteDto {
  @ApiPropertyOptional({
    description:
      'Existing product ID. When provided, productPriceUsd and marketplace are derived from the DB record.',
  })
  @IsUUID()
  @IsOptional()
  productId?: string;

  @ApiPropertyOptional({ description: 'Product price in USD (required when productId is omitted)' })
  @ValidateIf((o: LandedCostQuoteDto) => !o.productId)
  @IsNumber()
  @Min(0.01)
  productPriceUsd?: number;

  @ApiPropertyOptional({
    enum: ProductSource,
    description: 'Source marketplace (required when productId is omitted)',
  })
  @ValidateIf((o: LandedCostQuoteDto) => !o.productId)
  @IsEnum(ProductSource)
  marketplace?: ProductSource;

  @ApiPropertyOptional({
    enum: PRODUCT_CATEGORIES,
    description: 'Product category for weight estimation. Defaults to "generic".',
  })
  @IsEnum(PRODUCT_CATEGORIES)
  @IsOptional()
  category?: ProductCategory;

  @ApiProperty({ description: 'Number of units', default: 1 })
  @IsInt()
  @Min(1)
  quantity: number = 1;

  @ApiPropertyOptional({ description: 'Known weight in pounds. Overrides category default.' })
  @IsNumber()
  @Min(0)
  @IsOptional()
  weightLbs?: number;

  @ApiPropertyOptional({ description: 'Known box dimensions in inches. Overrides category default.' })
  @IsOptional()
  @ValidateNested()
  @Type(() => DimensionsDto)
  dimensions?: DimensionsDto;

  @ApiProperty({ enum: ['lagos', 'outside_lagos'] })
  @IsEnum(['lagos', 'outside_lagos'] as const)
  destination: ShippingDestination;

  @ApiProperty({ enum: ['air', 'ocean_small'] })
  @IsEnum(['air', 'ocean_small'] as const)
  shippingService: ShippingService;

  @ApiPropertyOptional({
    description: 'ISO 4217 currency code for the returned total. Defaults to "USD".',
  })
  @IsString()
  @IsOptional()
  displayCurrency?: string;

  @ApiPropertyOptional({
    description:
      'Actual marketplace tax in USD scraped from the product page or checkout simulation. ' +
      'When provided this bypasses the per-marketplace estimate so the quote reflects the real tax.',
  })
  @IsNumber()
  @Min(0)
  @IsOptional()
  taxAmountUsd?: number;
}
