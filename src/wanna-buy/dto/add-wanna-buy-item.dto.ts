import { IsString, IsUrl, IsOptional, IsObject } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class AddWannaBuyItemDto {
  @ApiProperty({ example: 'https://www.nike.com/t/air-max-90-mens-shoes-6n3vKB/CN8490-100' })
  @IsUrl()
  productUrl: string;

  @ApiPropertyOptional({ example: { size: '10', color: 'White' } })
  @IsOptional()
  @IsObject()
  variantSelection?: Record<string, string>;

  /** Known up front when the frontend picked an existing catalog product; skips the need to scrape it. */
  @ApiPropertyOptional({ example: 'Nike Air Max 90' })
  @IsOptional()
  @IsString()
  productTitle?: string;

  @ApiPropertyOptional({ example: 'https://example.com/image.jpg' })
  @IsOptional()
  @IsString()
  imageUrl?: string;
}
