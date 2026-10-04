import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsNumber, IsOptional, IsPositive, IsString, MaxLength } from 'class-validator';

export class AdminApproveManualImportToCartDto {
  @ApiProperty({ description: 'Verified supplier product price (numeric)', example: 45.0 })
  @IsNumber()
  @IsPositive()
  price: number;

  @ApiPropertyOptional({ description: 'Currency code (defaults to USD)', example: 'USD' })
  @IsOptional()
  @IsString()
  currency?: string;

  @ApiPropertyOptional({ description: 'Updated title (optional)' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  title?: string;
}
