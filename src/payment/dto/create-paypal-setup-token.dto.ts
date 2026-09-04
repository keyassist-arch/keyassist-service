import { IsOptional, IsUrl } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class CreatePaypalSetupTokenDto {
  @ApiPropertyOptional({ description: 'PayPal vault approval return URL (overrides PAYPAL_VAULT_RETURN_URL)' })
  @IsOptional()
  @IsUrl({ require_tld: false })
  returnUrl?: string;

  @ApiPropertyOptional({ description: 'PayPal vault approval cancel URL (overrides PAYPAL_VAULT_CANCEL_URL)' })
  @IsOptional()
  @IsUrl({ require_tld: false })
  cancelUrl?: string;
}
