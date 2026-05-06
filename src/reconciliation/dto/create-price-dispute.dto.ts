import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsNumber, IsOptional, IsString, IsUUID, MaxLength, Min } from 'class-validator';

export class CreatePriceDisputeDto {
  @ApiProperty({ description: 'Order ID to verify pricing for' })
  @IsUUID()
  orderId: string;

  @ApiPropertyOptional({
    description: 'Customer-observed total they expected to pay',
    example: 299.99,
  })
  @IsOptional()
  @IsNumber()
  @Min(0)
  expectedTotal?: number;

  @ApiPropertyOptional({
    description: 'Optional customer context for support',
    maxLength: 2048,
  })
  @IsOptional()
  @IsString()
  @MaxLength(2048)
  reason?: string;
}
