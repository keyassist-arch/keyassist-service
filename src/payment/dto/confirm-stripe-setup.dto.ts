import { IsNotEmpty, IsString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class ConfirmStripeSetupDto {
  @ApiProperty({ description: 'Stripe SetupIntent ID returned after frontend confirmation (si_...)' })
  @IsString()
  @IsNotEmpty()
  setupIntentId: string;
}
