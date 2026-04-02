import { Injectable, BadRequestException, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'node:crypto';
import axios from 'axios';
import Stripe from 'stripe';
import { OrdersService } from '../orders/orders.service';
import { OrderStatus } from '../common/enums/order-status.enum';
import { PaymentProvider } from '../common/enums/payment-provider.enum';
import {
  InitializePaymentDto,
  normalizePaystackChannels,
  normalizeStripePaymentMethodTypes,
} from './dto/initialize-payment.dto';
import { amountToMinorUnits } from './utils/amount-minor-units.util';
import { paystackChargeToMethodDetails } from './utils/paystack-payment-method.util';
import { stripePaymentMethodToDetails } from './utils/stripe-payment-method.util';

@Injectable()
export class PaymentService {
  private readonly logger = new Logger(PaymentService.name);
  private stripe: Stripe | null = null;

  constructor(
    private readonly config: ConfigService,
    private readonly ordersService: OrdersService,
  ) {}

  private getStripe(): Stripe {
    const key = this.config.get<string>('STRIPE_SECRET_KEY');
    if (!key) {
      throw new BadRequestException('Stripe is not configured');
    }
    if (!this.stripe) {
      this.stripe = new Stripe(key);
    }
    return this.stripe;
  }

  private paystackSecret(): string {
    const key = this.config.get<string>('PAYSTACK_SECRET_KEY');
    if (!key) {
      throw new BadRequestException('Paystack is not configured');
    }
    return key;
  }

  async initializePayment(
    dto: InitializePaymentDto,
    userId: string,
    email: string,
  ) {
    this.logger.log(
      `[payment] step=initialize_begin orderId=${dto.orderId} provider=${dto.provider} userId=${userId}`,
    );
    if (dto.provider === PaymentProvider.PAYSTACK) {
      return this.initPaystack(dto.orderId, userId, email, dto);
    }
    if (dto.provider === PaymentProvider.STRIPE) {
      return this.initStripe(dto.orderId, userId, email, dto);
    }
    throw new BadRequestException('Unsupported payment provider');
  }

  private async initPaystack(
    orderId: string,
    userId: string,
    email: string,
    dto: InitializePaymentDto,
  ) {
    const order = await this.ordersService.findById(orderId);
    if (order.userId !== userId) {
      throw new BadRequestException('Order not found');
    }
    if (order.status !== OrderStatus.PENDING) {
      throw new BadRequestException('Order is not payable in current state');
    }
    const minor = amountToMinorUnits(order.total, order.currency);
    const reference = `uc_${order.id}_${Date.now()}`;
    const paystackCurrency =
      this.config.get<string>('PAYSTACK_CURRENCY') || order.currency || 'NGN';
    const channels = normalizePaystackChannels(dto.paystackChannels);
    const body: Record<string, unknown> = {
      email,
      amount: minor,
      currency: paystackCurrency,
      reference,
      metadata: { orderId: order.id, userId },
      callback_url: this.config.get<string>('PAYSTACK_CALLBACK_URL'),
    };
    if (channels?.length) {
      body.channels = channels;
    }
    const { data } = await axios.post(
      'https://api.paystack.co/transaction/initialize',
      body,
      {
        headers: {
          Authorization: `Bearer ${this.paystackSecret()}`,
          'Content-Type': 'application/json',
        },
      },
    );
    if (!data?.status) {
      throw new BadRequestException(data?.message || 'Paystack error');
    }
    this.logger.log(
      `[payment] step=paystack_initialized orderId=${orderId} reference=${data.data.reference as string}`,
    );
    return {
      provider: PaymentProvider.PAYSTACK,
      authorizationUrl: data.data.authorization_url as string,
      accessCode: data.data.access_code as string,
      reference: data.data.reference as string,
      channels: channels ?? null,
    };
  }

  private async initStripe(
    orderId: string,
    userId: string,
    email: string,
    dto: InitializePaymentDto,
  ) {
    const order = await this.ordersService.findById(orderId);
    if (order.userId !== userId) {
      throw new BadRequestException('Order not found');
    }
    if (order.status !== OrderStatus.PENDING) {
      throw new BadRequestException('Order is not payable in current state');
    }
    const successUrl =
      dto.stripeSuccessUrl ??
      this.config.get<string>('STRIPE_CHECKOUT_SUCCESS_URL');
    const cancelUrl =
      dto.stripeCancelUrl ??
      this.config.get<string>('STRIPE_CHECKOUT_CANCEL_URL');
    if (!successUrl || !cancelUrl) {
      throw new BadRequestException(
        'Set STRIPE_CHECKOUT_SUCCESS_URL and STRIPE_CHECKOUT_CANCEL_URL (or pass stripeSuccessUrl / stripeCancelUrl)',
      );
    }
    if (!successUrl.includes('{CHECKOUT_SESSION_ID}')) {
      throw new BadRequestException(
        'Stripe success URL must include the literal substring {CHECKOUT_SESSION_ID}',
      );
    }

    const stripe = this.getStripe();
    const currency = order.currency.toLowerCase();
    const lineItems: Stripe.Checkout.SessionCreateParams.LineItem[] = (
      order.items ?? []
    ).map((item) => ({
      quantity: item.quantity,
      price_data: {
        currency,
        unit_amount: amountToMinorUnits(
          item.priceSnapshot,
          item.currencySnapshot || order.currency,
        ),
        product_data: {
          name: item.titleSnapshot.slice(0, 250),
        },
      },
    }));

    const pmTypes = normalizeStripePaymentMethodTypes(
      dto.stripePaymentMethodTypes,
    );
    const sessionParams: Stripe.Checkout.SessionCreateParams = {
      mode: 'payment',
      success_url: successUrl,
      cancel_url: cancelUrl,
      customer_email: email,
      client_reference_id: order.id,
      metadata: {
        orderId: order.id,
        userId,
      },
      line_items: lineItems,
    };
    if (pmTypes?.length) {
      sessionParams.payment_method_types = pmTypes;
    }

    const session = await stripe.checkout.sessions.create(sessionParams);
    await this.ordersService.setStripeCheckoutSession(
      order.id,
      userId,
      session.id,
    );

    return {
      provider: PaymentProvider.STRIPE,
      sessionId: session.id,
      url: session.url,
      paymentMethodTypes: pmTypes ?? null,
    };
  }

  verifyPaystackSignature(rawBody: Buffer, signature: string | undefined) {
    const secret =
      this.config.get<string>('PAYSTACK_WEBHOOK_SECRET') ||
      this.config.get<string>('PAYSTACK_SECRET_KEY');
    if (!secret || !signature) {
      return false;
    }
    const hash = crypto
      .createHmac('sha512', secret)
      .update(rawBody)
      .digest('hex');
    return hash === signature;
  }

  parseStripeWebhookEvent(
    rawBody: Buffer,
    signature: string | undefined,
  ): Stripe.Event {
    const whSecret = this.config.get<string>('STRIPE_WEBHOOK_SECRET');
    if (!whSecret || !signature) {
      throw new BadRequestException('Missing Stripe webhook configuration');
    }
    return this.getStripe().webhooks.constructEvent(
      rawBody,
      signature,
      whSecret,
    );
  }

  async handlePaystackChargeSuccess(data: {
    reference?: string;
    metadata?: { orderId?: string };
    channel?: string;
    authorization?: {
      brand?: string;
      card_type?: string;
      last4?: string;
      bank?: string;
      channel?: string;
    };
  }) {
    const orderId = data.metadata?.orderId;
    if (!orderId || !data.reference) {
      return;
    }
    const method = paystackChargeToMethodDetails(data);
    await this.ordersService.markOrderPaid(orderId, {
      provider: PaymentProvider.PAYSTACK,
      paystackReference: data.reference,
      paymentMethodDetails: method,
    });
  }

  async handleStripeCheckoutSessionCompleted(session: Stripe.Checkout.Session) {
    if (session.payment_status !== 'paid') {
      this.logger.warn(
        `Ignoring Stripe session ${session.id} with status ${session.payment_status}`,
      );
      return;
    }
    const orderId = session.metadata?.orderId;
    if (!orderId) {
      this.logger.warn(`Stripe session ${session.id} missing metadata.orderId`);
      return;
    }

    const stripe = this.getStripe();
    let paymentIntentId =
      typeof session.payment_intent === 'string'
        ? session.payment_intent
        : session.payment_intent?.id;

    let pm: Stripe.PaymentMethod | null = null;
    if (paymentIntentId) {
      const pi = await stripe.paymentIntents.retrieve(paymentIntentId, {
        expand: ['payment_method'],
      });
      paymentIntentId = pi.id;
      pm =
        typeof pi.payment_method === 'string'
          ? await stripe.paymentMethods.retrieve(pi.payment_method)
          : pi.payment_method;
    }

    const method = stripePaymentMethodToDetails(pm);

    this.logger.log(
      `[payment] step=stripe_checkout_apply orderId=${orderId} sessionId=${session.id}`,
    );
    await this.ordersService.markOrderPaid(orderId, {
      provider: PaymentProvider.STRIPE,
      stripeCheckoutSessionId: session.id,
      stripePaymentIntentId: paymentIntentId ?? null,
      paymentMethodDetails: method,
    });
  }
}
