import { IsEnum, IsOptional, IsString, IsUUID } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { PaymentProvider } from '../../common/enums/payment-provider.enum';

export class VerifyPaymentDto {
  @ApiProperty({
    format: 'uuid',
    description: 'Internal order id',
  })
  @IsUUID()
  orderId: string;

  @ApiPropertyOptional({
    enum: PaymentProvider,
    description: 'Optional payment provider hint',
  })
  @IsOptional()
  @IsEnum(PaymentProvider)
  provider?: PaymentProvider;

  @ApiPropertyOptional({
    description: 'Stripe Checkout Session ID (e.g. cs_test_...)',
  })
  @IsOptional()
  @IsString()
  sessionId?: string;

  @ApiPropertyOptional({
    description: 'Paystack transaction reference (e.g. uc_...)',
  })
  @IsOptional()
  @IsString()
  reference?: string;
}
