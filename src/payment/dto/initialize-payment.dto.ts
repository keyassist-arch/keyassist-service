import { IsArray, IsEnum, IsOptional, IsUrl, IsUUID } from 'class-validator';
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
  @IsUUID()
  orderId: string;

  @IsEnum(PaymentProvider)
  provider: PaymentProvider;

  /**
   * Paystack: restrict payment rails (omit = all enabled on your Paystack account).
   * @see https://paystack.com/docs/api/transaction/#initialize
   */
  @IsOptional()
  @IsArray()
  paystackChannels?: string[];

  /**
   * Stripe Checkout: restrict payment method types (omit = dynamic / dashboard defaults).
   * @see https://stripe.com/docs/api/checkout/sessions/create#create_checkout_session-payment_method_types
   */
  @IsOptional()
  @IsArray()
  stripePaymentMethodTypes?: string[];

  /** Overrides STRIPE_CHECKOUT_SUCCESS_URL when using Stripe */
  @IsOptional()
  @IsUrl({ require_tld: false })
  stripeSuccessUrl?: string;

  /** Overrides STRIPE_CHECKOUT_CANCEL_URL when using Stripe */
  @IsOptional()
  @IsUrl({ require_tld: false })
  stripeCancelUrl?: string;
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
