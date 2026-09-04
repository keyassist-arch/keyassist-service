import { ApiPropertyOptional, ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUrl,
  IsUUID,
  Min,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { ProductVariantDto } from './product-variant.dto';
import { ProductConfigurationPriceDto } from './product-configuration-price.dto';

export class AdminCreateProductDto {
  @ApiProperty({ example: 'Nike Air Force 1 Low' })
  @IsString()
  @MaxLength(500)
  title: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({ example: 'Nike' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  brand?: string;

  @ApiProperty({ example: 129.99, description: 'Base price in USD' })
  @IsNumber()
  @Min(0)
  originalPrice: number;

  @ApiProperty({ type: [String], example: ['https://api.example.com/uploads/products/abc123.jpg'] })
  @IsArray()
  @ArrayMaxSize(20)
  @IsUrl({}, { each: true })
  images: string[];

  @ApiPropertyOptional({ type: [ProductVariantDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ProductVariantDto)
  variants?: ProductVariantDto[];

  @ApiPropertyOptional({ type: [ProductConfigurationPriceDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ProductConfigurationPriceDto)
  configurationPrices?: ProductConfigurationPriceDto[];

  @ApiPropertyOptional({ description: 'Only meaningful when there are no variants — null/omit for unlimited' })
  @IsOptional()
  @IsInt()
  @Min(0)
  stockQuantity?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  categoryId?: string;

  @ApiPropertyOptional({ example: 'In Stock' })
  @IsOptional()
  @IsString()
  availability?: string;

  @ApiPropertyOptional({ description: '"Was" price for a strike-through display' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  compareAtPrice?: number;
}
