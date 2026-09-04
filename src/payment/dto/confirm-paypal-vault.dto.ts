import { IsNotEmpty, IsString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class ConfirmPaypalVaultDto {
  @ApiProperty({ description: 'PayPal setup token ID returned from /saved-methods/paypal/setup-token' })
  @IsString()
  @IsNotEmpty()
  setupTokenId: string;
}
