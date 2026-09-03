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

  /**
   * Customers are not asked for a price — admin quotes the request from the queue
   * (`POST /admin/manual-imports/:id/order`). Only admin-side tooling should send this.
   * Omitted price stores 0.00 USD, which also keeps the row out of the public catalog
   * until it is priced.
   */
  @ApiPropertyOptional({
    description:
      'Supplier price (numeric). Optional — leave unset for customer submissions; admin prices the request when placing the order.',
    example: 29.99,
  })
  @IsOptional()
  @IsNumber()
  @IsPositive()
  price?: number;

  @ApiPropertyOptional({
    description:
      'ISO 4217 currency code for `price`. Ignored when `price` is omitted.',
    example: 'USD',
  })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @IsISO4217CurrencyCode()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.toUpperCase() : value,
  )
  currency?: string;

  @ApiPropertyOptional({ maxLength: 200 })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  brand?: string;

  @ApiPropertyOptional({
    description:
      'Free-text details for the admin — size, colour, quantity, anything the link does not say.',
  })
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
  @IsUrl(
    { require_protocol: true },
    { message: 'sourceUrl must be a valid URL' },
  )
  @MaxLength(2048)
  sourceUrl: string;
}
