import { IsArray, IsEnum, IsOptional, IsUrl, IsUUID } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { PaymentProvider } from '../../common/enums/payment-provider.enum';

const PAYSTACK_CHANNELS = [
  'card',
  'bank',
  'ussd',
  'qr',
  'mobile_money',
  'bank_transfer',
  'eft',
] as const;

const STRIPE_PM_TYPES = [
  'card',
  'link',
  'us_bank_account',
  'ideal',
  'sepa_debit',
  'klarna',
  'afterpay_clearpay',
  'affirm',
] as const;

export type PaystackChannel = (typeof PAYSTACK_CHANNELS)[number];
export type StripeCheckoutPmType = (typeof STRIPE_PM_TYPES)[number];

export class InitializePaymentDto {
  @ApiProperty({
    format: 'uuid',
    description: 'Order id to initialize payment for',
  })
  @IsUUID()
  orderId: string;

  @ApiProperty({
    enum: PaymentProvider,
    description: 'Payment provider to initialize',
  })
  @IsEnum(PaymentProvider)
  provider: PaymentProvider;

  /**
   * Paystack: restrict payment rails (omit = all enabled on your Paystack account).
   * @see https://paystack.com/docs/api/transaction/#initialize
   */
  @IsOptional()
  @IsArray()
  @ApiPropertyOptional({
    type: [String],
    description: 'Optional Paystack channel allowlist',
  })
  paystackChannels?: string[];

  /**
   * Stripe Checkout: restrict payment method types (omit = dynamic / dashboard defaults).
   * @see https://stripe.com/docs/api/checkout/sessions/create#create_checkout_session-payment_method_types
   */
  @IsOptional()
  @IsArray()
  @ApiPropertyOptional({
    type: [String],
    description: 'Optional Stripe Checkout payment method type allowlist',
  })
  stripePaymentMethodTypes?: string[];

  /** Overrides STRIPE_CHECKOUT_SUCCESS_URL when using Stripe */
  @IsOptional()
  @IsUrl({ require_tld: false })
  @ApiPropertyOptional({
    description: 'Optional Stripe success URL override',
  })
  stripeSuccessUrl?: string;

  /** Overrides STRIPE_CHECKOUT_CANCEL_URL when using Stripe */
  @IsOptional()
  @IsUrl({ require_tld: false })
  @ApiPropertyOptional({
    description: 'Optional Stripe cancel URL override',
  })
  stripeCancelUrl?: string;

  /** Overrides PAYPAL_RETURN_URL when using PayPal */
  @IsOptional()
  @IsUrl({ require_tld: false })
  @ApiPropertyOptional({
    description: 'Optional PayPal return URL override',
  })
  paypalReturnUrl?: string;

  /** Overrides PAYPAL_CANCEL_URL when using PayPal */
  @IsOptional()
  @IsUrl({ require_tld: false })
  @ApiPropertyOptional({
    description: 'Optional PayPal cancel URL override',
  })
  paypalCancelUrl?: string;

  /** Overrides MYAZA_RETURN_URL when using Myaza crypto checkout */
  @IsOptional()
  @IsUrl({ require_tld: false })
  @ApiPropertyOptional({
    description: 'Optional Myaza return URL override',
  })
  myazaReturnUrl?: string;

  /** Overrides MYAZA_CANCEL_URL when using Myaza crypto checkout */
  @IsOptional()
  @IsUrl({ require_tld: false })
  @ApiPropertyOptional({
    description: 'Optional Myaza cancel URL override',
  })
  myazaCancelUrl?: string;

  @IsOptional()
  @IsUUID()
  @ApiPropertyOptional({
    format: 'uuid',
    description:
      'Saved payment method ID — skips hosted checkout and charges the saved card/PayPal wallet directly',
  })
  savedMethodId?: string;
}

export function normalizePaystackChannels(
  raw?: string[],
): PaystackChannel[] | undefined {
  if (!raw?.length) return undefined;
  const allowed = new Set<string>(PAYSTACK_CHANNELS);
  const out = raw.filter((c) => allowed.has(c)) as PaystackChannel[];
  return out.length ? out : undefined;
}

export function normalizeStripePaymentMethodTypes(
  raw?: string[],
): StripeCheckoutPmType[] | undefined {
  if (!raw?.length) return undefined;
  const allowed = new Set<string>(STRIPE_PM_TYPES);
  const out = raw.filter((c) => allowed.has(c)) as StripeCheckoutPmType[];
  return out.length ? out : undefined;
}
