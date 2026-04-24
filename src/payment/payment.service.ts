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

  private isDisabled(flagName: string): boolean {
    const raw = this.config.get<string>(flagName)?.trim().toLowerCase();
    return raw === '1' || raw === 'true';
  }

  getAvailableMethods() {
    const stripeConfigured = Boolean(
      this.config.get<string>('STRIPE_SECRET_KEY')?.trim(),
    );
    const paystackConfigured = Boolean(
      this.config.get<string>('PAYSTACK_SECRET_KEY')?.trim(),
    );
    const paypalConfigured = this.resolvePaypalClientCredentials() != null;
    const myazaConfigured = Boolean(
      this.config.get<string>('MYAZA_API_KEY')?.trim(),
    );

    const methods = [
      {
        provider: PaymentProvider.PAYSTACK,
        available:
          paystackConfigured && !this.isDisabled('PAYMENT_DISABLE_PAYSTACK'),
        reason: !paystackConfigured
          ? 'not_configured'
          : this.isDisabled('PAYMENT_DISABLE_PAYSTACK')
            ? 'temporarily_disabled'
            : null,
      },
      {
        provider: PaymentProvider.STRIPE,
        available: stripeConfigured && !this.isDisabled('PAYMENT_DISABLE_STRIPE'),
        reason: !stripeConfigured
          ? 'not_configured'
          : this.isDisabled('PAYMENT_DISABLE_STRIPE')
            ? 'temporarily_disabled'
            : null,
      },
      {
        provider: PaymentProvider.PAYPAL,
        available: paypalConfigured && !this.isDisabled('PAYMENT_DISABLE_PAYPAL'),
        reason: !paypalConfigured
          ? 'not_configured'
          : this.isDisabled('PAYMENT_DISABLE_PAYPAL')
            ? 'temporarily_disabled'
            : null,
      },
      {
        provider: PaymentProvider.MYAZA,
        available: myazaConfigured && !this.isDisabled('PAYMENT_DISABLE_MYAZA'),
        reason: !myazaConfigured
          ? 'not_configured'
          : this.isDisabled('PAYMENT_DISABLE_MYAZA')
            ? 'temporarily_disabled'
            : null,
      },
    ];

    return {
      methods,
      updatedAt: new Date().toISOString(),
    };
  }

  private assertMethodAvailable(provider: PaymentProvider): void {
    const availability = this.getAvailableMethods();
    const method = availability.methods.find((m) => m.provider === provider);
    if (!method || !method.available) {
      throw new BadRequestException(
        `Payment method ${provider} is currently unavailable`,
      );
    }
  }

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

  private isPaypalLiveMode(): boolean {
    const m = this.config.get<string>('PAYPAL_MODE')?.trim().toLowerCase();
    return m === 'live' || m === 'production' || m === 'prod';
  }

  private paypalBaseUrl(): string {
    return this.isPaypalLiveMode()
      ? 'https://api-m.paypal.com'
      : 'https://api-m.sandbox.paypal.com';
  }

  /**
   * Secret: `PAYPAL_SECRET_KEY` or PayPal’s usual `PAYPAL_CLIENT_SECRET` if the former is unset.
   */
  private resolvePaypalClientCredentials():
    | { clientId: string; secret: string }
    | null {
    const clientId = this.config.get<string>('PAYPAL_CLIENT_ID')?.trim();
    const secret =
      this.config.get<string>('PAYPAL_SECRET_KEY')?.trim() ||
      this.config.get<string>('PAYPAL_CLIENT_SECRET')?.trim();
    if (!clientId || !secret) {
      return null;
    }
    return { clientId, secret };
  }

  private paypalCredentials(): { clientId: string; secret: string } {
    const c = this.resolvePaypalClientCredentials();
    if (!c) {
      throw new BadRequestException('PayPal is not configured');
    }
    return c;
  }

  private async paypalAccessToken(): Promise<string> {
    const { clientId, secret } = this.paypalCredentials();
    const basic = Buffer.from(`${clientId}:${secret}`).toString('base64');
    const base = this.paypalBaseUrl();
    const host = this.isPaypalLiveMode() ? 'api-m.paypal.com' : 'api-m.sandbox.paypal.com';
    try {
      const { data } = await axios.post<{ access_token?: string }>(
        `${base}/v1/oauth2/token`,
        'grant_type=client_credentials',
        {
          headers: {
            Authorization: `Basic ${basic}`,
            'Content-Type': 'application/x-www-form-urlencoded',
          },
        },
      );
      const token = data?.access_token;
      if (!token) {
        throw new BadRequestException('Could not authenticate with PayPal');
      }
      return token;
    } catch (e) {
      if (axios.isAxiosError(e) && e.response?.status === 401) {
        this.logger.warn(
          `[payment] paypal oauth 401 base=${base} — invalid client/secret or wrong environment`,
        );
        throw new BadRequestException(
          'PayPal OAuth failed (401). Use the Client ID and Secret from the same ' +
            'PayPal developer app; sandbox keys only work with sandbox (PAYPAL_MODE empty or ' +
            `not live); this call uses host ${host}. ` +
            'Set PAYPAL_SECRET_KEY or PAYPAL_CLIENT_SECRET (no quotes or trailing spaces). ' +
            'If you use Live credentials, set PAYPAL_MODE=live (or production).',
        );
      }
      throw e;
    }
  }

  private myazaConfig(): {
    baseUrl: string;
    sessionsPath: string;
    apiKey: string;
    chain: string;
    token: string;
    expiresInMinutes: number;
    webhookUrl?: string;
  } {
    const baseUrl =
      this.config.get<string>('MYAZA_BASE_URL')?.trim() ||
      'https://api.myaza.io';
    const sessionsRaw =
      this.config.get<string>('MYAZA_SESSIONS_PATH')?.trim() ||
      '/api/v1/pos/sessions';
    const sessionsPath = sessionsRaw.startsWith('/')
      ? sessionsRaw
      : `/${sessionsRaw}`;
    const apiKey = this.config.get<string>('MYAZA_API_KEY')?.trim();
    const chain = this.config.get<string>('MYAZA_CHAIN')?.trim() || 'polygon';
    const token = this.config.get<string>('MYAZA_TOKEN')?.trim() || 'USDC';
    const expiresRaw = this.config.get<string>('MYAZA_EXPIRES_MINUTES')?.trim();
    const expiresInMinutes = Number.isFinite(Number(expiresRaw))
      ? Number(expiresRaw)
      : 15;
    const webhookUrl = this.config.get<string>('MYAZA_WEBHOOK_URL')?.trim();
    if (!apiKey) {
      throw new BadRequestException('Myaza is not configured');
    }
    return {
      baseUrl: baseUrl.replace(/\/+$/, ''),
      sessionsPath,
      apiKey,
      chain,
      token,
      expiresInMinutes,
      webhookUrl: webhookUrl || undefined,
    };
  }

  /**
   * When MYAZA_BASE_URL already ends with `/api/v1`, the default sessions path
   * `/api/v1/pos/sessions` would duplicate the prefix — normalize to `/pos/sessions`.
   */
  private myazaSessionUrl(baseUrl: string, sessionsPath: string): string {
    const b = baseUrl.replace(/\/+$/, '');
    let p = sessionsPath.startsWith('/') ? sessionsPath : `/${sessionsPath}`;
    if (b.endsWith('/api/v1') && p.startsWith('/api/v1/')) {
      p = p.slice('/api/v1'.length);
      if (!p.startsWith('/')) {
        p = `/${p}`;
      }
    }
    return `${b}${p}`;
  }

  /**
   * Myaza deployments differ: some expect `X-API-Key`, others `Authorization: Bearer` (JWT-style
   * "auth token"). `MYAZA_AUTH_MODE` selects which header receives `MYAZA_API_KEY`.
   */
  private buildMyazaRequestHeaders(apiKey: string): Record<string, string> {
    const mode =
      this.config.get<string>('MYAZA_AUTH_MODE')?.trim().toLowerCase() ||
      'x-api-key';
    const h: Record<string, string> = { 'Content-Type': 'application/json' };
    if (mode === 'bearer' || mode === 'authorization' || mode === 'jwt') {
      h.Authorization = `Bearer ${apiKey}`;
    } else {
      h['X-API-Key'] = apiKey;
    }
    return h;
  }

  async initializePayment(
    dto: InitializePaymentDto,
    userId: string,
    email: string,
  ) {
    this.assertMethodAvailable(dto.provider);
    this.logger.log(
      `[payment] step=initialize_begin orderId=${dto.orderId} provider=${dto.provider} userId=${userId}`,
    );
    if (dto.provider === PaymentProvider.PAYSTACK) {
      return this.initPaystack(dto.orderId, userId, email, dto);
    }
    if (dto.provider === PaymentProvider.STRIPE) {
      return this.initStripe(dto.orderId, userId, email, dto);
    }
    if (dto.provider === PaymentProvider.PAYPAL) {
      return this.initPaypal(dto.orderId, userId, email, dto);
    }
    if (dto.provider === PaymentProvider.MYAZA) {
      return this.initMyaza(dto.orderId, userId, email, dto);
    }
    throw new BadRequestException('Unsupported payment provider');
  }

  private async initMyaza(
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
    const {
      baseUrl,
      sessionsPath,
      apiKey,
      chain,
      token,
      expiresInMinutes,
      webhookUrl,
    } = this.myazaConfig();
    const sessionUrl = this.myazaSessionUrl(baseUrl, sessionsPath);
    const returnUrl =
      dto.myazaReturnUrl ?? this.config.get<string>('MYAZA_RETURN_URL');
    const cancelUrl =
      dto.myazaCancelUrl ?? this.config.get<string>('MYAZA_CANCEL_URL');
    if (!returnUrl || !cancelUrl) {
      throw new BadRequestException(
        'Set MYAZA_RETURN_URL and MYAZA_CANCEL_URL (or pass myazaReturnUrl / myazaCancelUrl)',
      );
    }
    const body: Record<string, unknown> = {
      amount: order.total,
      currency: order.currency,
      chain,
      token,
      expiresInMinutes,
      metadata: { orderId: order.id, userId },
      returnUrl,
      cancelUrl,
      ...(webhookUrl ? { webhookUrl } : {}),
    };
    const headers = this.buildMyazaRequestHeaders(apiKey);
    let data: {
      id?: string;
      sessionId?: string;
      address?: string;
      depositAddress?: string;
      qrCode?: string;
      qrCodeDataUrl?: string;
      qrCodeUrl?: string;
      amount?: string;
      symbol?: string;
      token?: string;
      chain?: string;
      status?: string;
      expiresAt?: string;
      createdAt?: string;
      checkoutUrl?: string;
      hostedUrl?: string;
      paymentUrl?: string;
      reference?: string;
      txId?: string;
      txHash?: string;
    };
    try {
      ({ data } = await axios.post(sessionUrl, body, { headers }));
    } catch (e) {
      if (axios.isAxiosError(e)) {
        const status = e.response?.status;
        const detail = e.response?.data;
        this.logger.warn(
          `[payment] myaza init axios status=${status} url=${sessionUrl} ` +
            `response=${typeof detail === 'string' ? detail : JSON.stringify(detail)}`,
        );
        if (status === 404) {
          throw new BadRequestException(
            'Myaza returned 404 for the session URL. ' +
              'Set MYAZA_BASE_URL to the API host only (e.g. https://api.myaza.io) and, ' +
              'if Myaza changed their API, set MYAZA_SESSIONS_PATH to the path they document for creating sessions.',
          );
        }
        if (status === 401) {
          throw new BadRequestException(
            'Myaza rejected the API key (401). Value is sent from MYAZA_API_KEY. ' +
              'If the server expects a Bearer token, set MYAZA_AUTH_MODE=bearer. ' +
              'If it expects X-API-Key, use MYAZA_AUTH_MODE=x-api-key (default).',
          );
        }
        throw new BadRequestException(
          `Myaza API request failed${status != null ? ` (${status})` : ''}: ${e.message}`,
        );
      }
      throw e;
    }
    const checkoutUrl = data?.paymentUrl || data?.checkoutUrl || data?.hostedUrl;
    const paymentId = data?.sessionId || data?.id || data?.reference;
    const depositAddress = data?.depositAddress || data?.address;
    if (!paymentId || !depositAddress) {
      throw new BadRequestException('Myaza initialization failed');
    }
    await this.ordersService.setPendingCheckoutReference(order.id, userId, {
      provider: PaymentProvider.MYAZA,
      checkoutId: paymentId,
      details: {
        myazaSessionId: paymentId,
        depositAddress,
        chain: data?.chain ?? chain,
        token: data?.symbol ?? data?.token ?? token,
        amount: data?.amount ?? order.total,
      },
    });
    return {
      provider: PaymentProvider.MYAZA,
      paymentId,
      sessionId: paymentId,
      checkoutUrl: checkoutUrl ?? null,
      depositAddress,
      qrCode: data?.qrCode ?? data?.qrCodeDataUrl ?? data?.qrCodeUrl ?? null,
      chain: data?.chain ?? chain,
      token: data?.symbol ?? data?.token ?? token,
      amount: data?.amount ?? order.total,
      status: data?.status ?? 'pending',
      expiresAt: data?.expiresAt ?? null,
      createdAt: data?.createdAt ?? null,
    };
  }

  private async initPaypal(
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
    const returnUrl =
      dto.paypalReturnUrl ?? this.config.get<string>('PAYPAL_RETURN_URL');
    const cancelUrl =
      dto.paypalCancelUrl ?? this.config.get<string>('PAYPAL_CANCEL_URL');
    if (!returnUrl || !cancelUrl) {
      throw new BadRequestException(
        'Set PAYPAL_RETURN_URL and PAYPAL_CANCEL_URL (or pass paypalReturnUrl / paypalCancelUrl)',
      );
    }
    const token = await this.paypalAccessToken();
    const currencyCode = (order.currency || 'USD').toUpperCase();
    const body = {
      intent: 'CAPTURE',
      purchase_units: [
        {
          reference_id: order.id,
          amount: {
            currency_code: currencyCode,
            value: order.total,
          },
          custom_id: order.id,
        },
      ],
      payer: { email_address: email },
      application_context: {
        return_url: returnUrl,
        cancel_url: cancelUrl,
        user_action: 'PAY_NOW',
      },
    };
    const { data } = await axios.post<{
      id?: string;
      links?: Array<{ rel?: string; href?: string }>;
    }>(`${this.paypalBaseUrl()}/v2/checkout/orders`, body, {
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
    });
    const paypalOrderId = data?.id;
    const approveUrl = data?.links?.find((l) => l.rel === 'approve')?.href;
    if (!paypalOrderId || !approveUrl) {
      throw new BadRequestException('PayPal initialization failed');
    }
    await this.ordersService.setPendingCheckoutReference(order.id, userId, {
      provider: PaymentProvider.PAYPAL,
      checkoutId: paypalOrderId,
      details: {
        paypalOrderId,
        paypalApprovalUrl: approveUrl,
      },
    });
    return {
      provider: PaymentProvider.PAYPAL,
      paypalOrderId,
      approvalUrl: approveUrl,
    };
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
    await this.ordersService.setPendingCheckoutReference(order.id, userId, {
      provider: PaymentProvider.PAYSTACK,
      checkoutId: String(data.data.reference),
      paystackReference: String(data.data.reference),
      details: {
        paystackAccessCode: data.data.access_code as string,
      },
    });
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
    const subtotal = parseFloat(order.subtotal);
    const total = parseFloat(order.total);
    const netFees = total - subtotal;
    if (Number.isFinite(netFees) && netFees > 0) {
      lineItems.push({
        quantity: 1,
        price_data: {
          currency,
          unit_amount: amountToMinorUnits(netFees.toFixed(2), order.currency),
          product_data: {
            name: 'Service charge',
          },
        },
      });
    }

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
    await this.ordersService.setPendingCheckoutReference(order.id, userId, {
      provider: PaymentProvider.STRIPE,
      checkoutId: session.id,
      stripeCheckoutSessionId: session.id,
      details: {
        stripeCheckoutUrl: session.url ?? null,
      },
    });

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

  verifyMyazaSignature(rawBody: Buffer, signature: string | undefined) {
    const secret = this.config.get<string>('MYAZA_WEBHOOK_SECRET');
    if (!secret || !signature) {
      return false;
    }
    const hash = crypto
      .createHmac('sha256', secret)
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

  async capturePaypalOrder(
    orderId: string,
    userId: string,
    paypalOrderId: string,
  ) {
    const order = await this.ordersService.findById(orderId);
    if (order.userId !== userId) {
      throw new BadRequestException('Order not found');
    }
    if (order.status !== OrderStatus.PENDING) {
      throw new BadRequestException('Order is not payable in current state');
    }
    const token = await this.paypalAccessToken();
    const { data } = await axios.post<{
      id?: string;
      status?: string;
      purchase_units?: Array<{
        reference_id?: string;
        payments?: {
          captures?: Array<{
            id?: string;
            status?: string;
            amount?: { value?: string; currency_code?: string };
          }>;
        };
      }>;
      payer?: { payer_id?: string; email_address?: string };
    }>(
      `${this.paypalBaseUrl()}/v2/checkout/orders/${encodeURIComponent(paypalOrderId)}/capture`,
      {},
      {
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
      },
    );
    const pu = data.purchase_units?.[0];
    if (pu?.reference_id && pu.reference_id !== orderId) {
      throw new BadRequestException('PayPal order does not match this order');
    }
    const capture = pu?.payments?.captures?.[0];
    if (!capture?.id || capture.status !== 'COMPLETED') {
      throw new BadRequestException('PayPal capture not completed');
    }
    await this.ordersService.markOrderPaid(orderId, {
      provider: PaymentProvider.PAYPAL,
      paymentMethodDetails: {
        provider: PaymentProvider.PAYPAL,
        label: 'PayPal',
        paypalOrderId: data.id ?? paypalOrderId,
        paypalCaptureId: capture.id,
        payerId: data.payer?.payer_id,
        payerEmail: data.payer?.email_address,
      },
    });
    return {
      provider: PaymentProvider.PAYPAL,
      orderId,
      paypalOrderId: data.id ?? paypalOrderId,
      paypalCaptureId: capture.id,
      status: 'PAID',
    };
  }

  async handleMyazaPaymentSuccess(data: {
    reference?: string;
    status?: string;
    txHash?: string;
    transactionHash?: string;
    txId?: string;
    address?: string;
    chain?: string;
    amount?: string;
    symbol?: string;
    id?: string;
    metadata?: { orderId?: string };
  }) {
    const orderId = data.metadata?.orderId || data.reference;
    const status = (data.status || '').toLowerCase();
    if (
      !orderId ||
      !['paid', 'completed', 'confirmed', 'success', 'delivered'].includes(status)
    ) {
      return;
    }
    await this.ordersService.markOrderPaid(orderId, {
      provider: PaymentProvider.MYAZA,
      paymentMethodDetails: {
        provider: PaymentProvider.MYAZA,
        label: 'Myaza Crypto',
        myazaPaymentId: data.id ?? null,
        txHash: data.txHash ?? data.transactionHash ?? data.txId ?? null,
        address: data.address ?? null,
        chain: data.chain ?? null,
        amount: data.amount ?? null,
        symbol: data.symbol ?? null,
        status: data.status ?? null,
      },
    });
  }
}
