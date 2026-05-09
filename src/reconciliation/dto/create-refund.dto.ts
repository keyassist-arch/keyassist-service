import {
  IsEnum,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  IsUUID,
  Max,
  MaxLength,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateRefundDto {
  @ApiProperty({ description: 'Order ID to refund' })
  @IsUUID()
  orderId: string;

  /**
   * Amount to refund in the order currency (e.g. 49.99).
   * Must not exceed the original order total — enforced in the service.
   * Omit to issue a full refund.
   */
  @ApiPropertyOptional({
    description: 'Amount to refund (order currency). Omit for full refund.',
  })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @IsPositive()
  @Max(999_999.99)
  amount?: number;

  @ApiPropertyOptional({ description: 'Reason shown to the customer' })
  @IsOptional()
  @IsString()
  @MaxLength(512)
  reason?: string;

  @ApiPropertyOptional({
    description: 'Internal staff note (not sent to customer)',
  })
  @IsOptional()
  @IsString()
  @MaxLength(1024)
  internalNote?: string;
}

export enum RefundProviderReason {
  DUPLICATE = 'duplicate',
  FRAUDULENT = 'fraudulent',
  REQUESTED_BY_CUSTOMER = 'requested_by_customer',
}
