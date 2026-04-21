import { IsString, IsUUID } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CapturePaypalPaymentDto {
  @ApiProperty({
    format: 'uuid',
    description: 'Internal order id',
  })
  @IsUUID()
  orderId: string;

  @ApiProperty({
    description: 'PayPal order id returned from initialize',
  })
  @IsString()
  paypalOrderId: string;
}

