import { IsNumber, IsOptional, IsString, IsBoolean, Min } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class AdminQuoteWannaBuyItemDto {
  @ApiPropertyOptional({ description: 'Admin override for the product price in USD' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  adminPriceUsd?: number;

  @ApiPropertyOptional({ description: 'Note explaining why the price was edited' })
  @IsOptional()
  @IsString()
  priceEditNote?: string;

  @ApiPropertyOptional({ description: 'Actual marketplace tax amount in USD (entered by team)' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  taxAmountUsd?: number;

  @ApiPropertyOptional({ description: 'Kingz international shipping cost in USD' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  kingzShippingUsd?: number;

  @ApiPropertyOptional({ description: 'Send quote notification to user after saving' })
  @IsOptional()
  @IsBoolean()
  notifyUser?: boolean;
}
