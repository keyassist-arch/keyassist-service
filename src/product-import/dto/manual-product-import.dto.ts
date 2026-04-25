import {
  ArrayMaxSize,
  IsArray,
  IsISO4217CurrencyCode,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  IsUrl,
  MaxLength,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';

export class ManualProductImportDto {
  @ApiProperty({ description: 'Product title', maxLength: 500 })
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  title: string;

  @ApiProperty({ description: 'Supplier price (numeric)', example: 29.99 })
  @IsNumber()
  @IsPositive()
  price: number;

  @ApiProperty({ description: 'ISO 4217 currency code', example: 'NGN' })
  @IsString()
  @IsNotEmpty()
  @IsISO4217CurrencyCode()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.toUpperCase() : value,
  )
  currency: string;

  @ApiPropertyOptional({ maxLength: 200 })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  brand?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({ type: [String], description: 'Image URLs' })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsUrl({}, { each: true })
  imageUrls?: string[];

  @ApiProperty({ description: 'Original product page URL' })
  @IsUrl({ require_protocol: true }, { message: 'sourceUrl must be a valid URL' })
  @MaxLength(2048)
  sourceUrl: string;
}
