import { ApiPropertyOptional, ApiProperty } from '@nestjs/swagger';
import {
  IsBoolean,
  IsInt,
  IsNumberString,
  IsObject,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';

export class ProductConfigurationPriceDto {
  @ApiProperty({ example: 'Size 9 — Black' })
  @IsString()
  label: string;

  @ApiProperty({ example: '129.99' })
  @IsNumberString()
  originalPrice: string;

  @ApiPropertyOptional({ example: 'SKU-9-BLK' })
  @IsOptional()
  @IsString()
  sku?: string;

  @ApiPropertyOptional({
    example: { Size: '9', Color: 'Black' },
    description: 'Variant axis → selected option for this combination',
  })
  @IsOptional()
  @IsObject()
  variantSelections?: Record<string, string>;

  @ApiPropertyOptional({ description: 'false = show as out of stock' })
  @IsOptional()
  @IsBoolean()
  available?: boolean;

  @ApiPropertyOptional({ description: 'Stock count for this specific combination (display only for now — not enforced at checkout)' })
  @IsOptional()
  @IsInt()
  @Min(0)
  stockQuantity?: number;
}
