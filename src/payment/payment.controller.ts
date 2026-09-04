import {
  Body,
  Controller,
  Get,
  Headers,
  Logger,
  Post,
  Req,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import type { RawBodyRequest } from '@nestjs/common';
import type { Request as ExpressRequest } from 'express';
import Stripe from 'stripe';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { JwtPayload } from '../auth/interfaces/jwt-payload.interface';
import { PaymentService } from './payment.service';
import { Public } from '../common/decorators/public.decorator';
import { UsersService } from '../users/users.service';
import { InitializePaymentDto } from './dto/initialize-payment.dto';
import { SWAGGER_JWT_AUTH } from '../common/constants/swagger-auth';
import { CapturePaypalPaymentDto } from './dto/capture-paypal-payment.dto';
import { VerifyPaymentDto } from './dto/verify-payment.dto';

@ApiTags('Payments')
@Controller('payments')
export class PaymentController {
  private readonly logger = new Logger(PaymentController.name);

  constructor(
    private readonly paymentService: PaymentService,
    private readonly usersService: UsersService,
  ) {}

  @Get('methods')
  @ApiOperation({
    summary: 'List currently available payment methods for checkout rendering',
  })
  @ApiOkResponse({
    description: 'Currently available payment methods for checkout',
    schema: {
      type: 'object',
      properties: {
        methods: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              provider: {
                type: 'string',
                enum: ['paystack', 'stripe', 'paypal', 'myaza'],
              },
              available: { type: 'boolean' },
              reason: {
                type: 'string',
                nullable: true,
                enum: ['not_configured', 'temporarily_disabled'],
              },
            },
          },
        },
        updatedAt: { type: 'string', format: 'date-time' },
      },
    },
  })
  getMethods() {
    return this.paymentService.getAvailableMethods();
  }

  @Post('initialize')
  @ApiBearerAuth(SWAGGER_JWT_AUTH)
  @ApiOperation({
    summary:
      'Start Paystack, Stripe, PayPal, or Myaza checkout for a pending order',
  })
  @UseGuards(JwtAuthGuard)
  async initialize(
    @CurrentUser() user: JwtPayload,
    @Body() dto: InitializePaymentDto,
  ) {
    const u = await this.usersService.findById(user.sub);
    return this.paymentService.initializePayment(dto, user.sub, u.email);
  }

  @Post('verify')
  @ApiBearerAuth(SWAGGER_JWT_AUTH)
  @ApiOperation({
    summary: 'Verify Stripe, Paystack, or pending order payment status upon return',
  })
  @UseGuards(JwtAuthGuard)
  async verifyPayment(
    @CurrentUser() user: JwtPayload,
    @Body() dto: VerifyPaymentDto,
  ) {
    return this.paymentService.verifyPayment({
      orderId: dto.orderId,
      userId: user.sub,
      sessionId: dto.sessionId,
      reference: dto.reference,
    });
  }

  @Post('paypal/capture')
  @ApiBearerAuth(SWAGGER_JWT_AUTH)
  @ApiOperation({
    summary: 'Capture an approved PayPal order and mark order as paid',
  })
  @UseGuards(JwtAuthGuard)
  async capturePaypal(
    @CurrentUser() user: JwtPayload,
    @Body() dto: CapturePaypalPaymentDto,
  ) {
    return this.paymentService.capturePaypalOrder(
      dto.orderId,
      user.sub,
      dto.paypalOrderId,
    );
  }

  @Public()
  @Post('webhooks/paystack')
  @ApiOperation({
    summary: 'Paystack webhook (server-to-server)',
    description:
      'Requires raw body + `x-paystack-signature`. Not for browser calls.',
  })
  async paystackWebhook(
    @Req() req: RawBodyRequest<ExpressRequest & { rawBody?: Buffer }>,
    @Headers('x-paystack-signature') signature: string,
  ) {
    const raw =
      req.rawBody ?? Buffer.from(JSON.stringify((req.body as object) ?? {}));
    const ok = this.paymentService.verifyPaystackSignature(raw, signature);
    if (!ok) {
      this.logger.warn('[payment] step=webhook_paystack reason=bad_signature');
      // Return non-200 so Paystack knows delivery failed and will retry the webhook.
      throw new UnauthorizedException('Invalid webhook signature');
    }
    const body = req.body as {
      event?: string;
      data?: {
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
      };
    };
    this.logger.log(
      `[payment] step=webhook_paystack event=${body.event ?? 'unknown'}`,
    );
    if (body.event === 'charge.success' && body.data) {
      await this.paymentService.handlePaystackChargeSuccess(body.data);
    }
    return { received: true };
  }

  @Public()
  @Post('webhooks/stripe')
  @ApiOperation({
    summary: 'Stripe webhook (server-to-server)',
    description:
      'Requires raw body + `stripe-signature`. Not for browser calls.',
  })
  async stripeWebhook(
    @Req() req: RawBodyRequest<ExpressRequest & { rawBody?: Buffer }>,
    @Headers('stripe-signature') signature: string,
  ) {
    const raw = req.rawBody;
    if (!raw?.length) {
      this.logger.warn('[payment] step=webhook_stripe reason=empty_body');
      return { received: false };
    }
    let event: Stripe.Event;
    try {
      event = this.paymentService.parseStripeWebhookEvent(raw, signature);
    } catch {
      this.logger.warn(
        '[payment] step=webhook_stripe reason=invalid_signature',
      );
      throw new UnauthorizedException('Invalid Stripe webhook signature');
    }
    this.logger.log(`[payment] step=webhook_stripe type=${event.type}`);
    if (event.type === 'checkout.session.completed') {
      await this.paymentService.handleStripeCheckoutSessionCompleted(
        event.data.object,
      );
    }
    return { received: true };
  }

  @Public()
  @Post('webhooks/myaza')
  @ApiOperation({
    summary: 'Myaza webhook (server-to-server)',
    description:
      'Optional signature verification via `x-myaza-signature` + MYAZA_WEBHOOK_SECRET.',
  })
  async myazaWebhook(
    @Req() req: RawBodyRequest<ExpressRequest & { rawBody?: Buffer }>,
    @Headers('x-myaza-signature') signature: string,
  ) {
    const raw =
      req.rawBody ?? Buffer.from(JSON.stringify((req.body as object) ?? {}));
    const shouldVerify =
      Boolean(process.env.MYAZA_WEBHOOK_SECRET) && Boolean(signature);
    if (
      shouldVerify &&
      !this.paymentService.verifyMyazaSignature(raw, signature)
    ) {
      this.logger.warn('[payment] step=webhook_myaza reason=bad_signature');
      // Return non-200 so Myaza knows delivery failed and will retry the webhook.
      throw new UnauthorizedException('Invalid webhook signature');
    }
    const body = req.body as {
      event?: string;
      data?: {
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
      };
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
    };
    this.logger.log(
      `[payment] step=webhook_myaza event=${body.event ?? 'unknown'}`,
    );
    await this.paymentService.handleMyazaPaymentSuccess(body.data ?? body);
    return { received: true };
  }
}
