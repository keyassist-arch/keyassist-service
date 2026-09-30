import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsNumber, IsOptional, Max, Min } from 'class-validator';

export class UpdateDiscountSettingsDto {
  @ApiPropertyOptional({
    description:
      'Fraction (0–1) of the platform fee discounted on a first order. 0 disables it.',
    example: 0.5,
  })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(1)
  firstOrderDiscountRate?: number;

  @ApiPropertyOptional({
    description:
      'Fraction (0–1) of the product subtotal discounted above the threshold. 0 disables it.',
    example: 0.2,
  })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(1)
  volumeDiscountRate?: number;

  @ApiPropertyOptional({
    description:
      'Product subtotal (USD) that must be exceeded for the volume discount to apply.',
    example: 1000,
  })
  @IsOptional()
  @IsNumber()
  @Min(0)
  volumeDiscountThresholdUsd?: number;
}
