import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  Logger,
  Param,
  Patch,
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
import { ConfirmStripeSetupDto } from './dto/confirm-stripe-setup.dto';
import { ConfirmPaypalVaultDto } from './dto/confirm-paypal-vault.dto';
import { CreatePaypalSetupTokenDto } from './dto/create-paypal-setup-token.dto';

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
        label?: string;
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
      label?: string;
      metadata?: { orderId?: string };
    };
    this.logger.log(
      `[payment] step=webhook_myaza event=${body.event ?? 'unknown'}`,
    );
    await this.paymentService.handleMyazaPaymentSuccess(body.data ?? body);
    return { received: true };
  }

  // ---------------------------------------------------------------------------
  // Saved payment methods (card vault)
  // ---------------------------------------------------------------------------

  @Get('saved-methods')
  @ApiBearerAuth(SWAGGER_JWT_AUTH)
  @ApiOperation({ summary: "List the current user's saved payment methods" })
  @UseGuards(JwtAuthGuard)
  listSavedMethods(@CurrentUser() user: JwtPayload) {
    return this.paymentService.listSavedMethods(user.sub);
  }

  @Post('saved-methods/stripe/setup-intent')
  @ApiBearerAuth(SWAGGER_JWT_AUTH)
  @ApiOperation({
    summary: 'Create a Stripe SetupIntent to vault a new card',
    description:
      'Returns a clientSecret. Pass it to stripe.confirmSetup() in Stripe.js to let the user enter their card. Then call /saved-methods/stripe/confirm with the resulting setupIntentId.',
  })
  @UseGuards(JwtAuthGuard)
  async stripeSetupIntent(@CurrentUser() user: JwtPayload) {
    const u = await this.usersService.findById(user.sub);
    return this.paymentService.createStripeSetupIntent(user.sub, u.email);
  }

  @Post('saved-methods/stripe/confirm')
  @ApiBearerAuth(SWAGGER_JWT_AUTH)
  @ApiOperation({
    summary: 'Confirm a Stripe SetupIntent and save the card to the vault',
    description:
      'Call after stripe.confirmSetup() succeeds. Retrieves the PaymentMethod from the SetupIntent and saves it for future use.',
  })
  @UseGuards(JwtAuthGuard)
  async stripeConfirmSetup(
    @CurrentUser() user: JwtPayload,
    @Body() dto: ConfirmStripeSetupDto,
  ) {
    return this.paymentService.confirmStripeSetup(user.sub, dto.setupIntentId);
  }

  @Post('saved-methods/paypal/setup-token')
  @ApiBearerAuth(SWAGGER_JWT_AUTH)
  @ApiOperation({
    summary: 'Create a PayPal vault setup token',
    description:
      'Returns a setupTokenId and approvalUrl. Redirect the user to approvalUrl to authorise vaulting their PayPal account. Then call /saved-methods/paypal/confirm with the setupTokenId.',
  })
  @UseGuards(JwtAuthGuard)
  async paypalSetupToken(
    @CurrentUser() user: JwtPayload,
    @Body() dto: CreatePaypalSetupTokenDto,
  ) {
    return this.paymentService.createPaypalSetupToken(
      user.sub,
      dto.returnUrl,
      dto.cancelUrl,
    );
  }

  @Post('saved-methods/paypal/confirm')
  @ApiBearerAuth(SWAGGER_JWT_AUTH)
  @ApiOperation({
    summary: 'Convert a PayPal setup token into a reusable vault token and save it',
    description: 'Call after the user approves at the PayPal approvalUrl.',
  })
  @UseGuards(JwtAuthGuard)
  async paypalConfirmVault(
    @CurrentUser() user: JwtPayload,
    @Body() dto: ConfirmPaypalVaultDto,
  ) {
    return this.paymentService.confirmPaypalVault(user.sub, dto.setupTokenId);
  }

  @Patch('saved-methods/:id/default')
  @ApiBearerAuth(SWAGGER_JWT_AUTH)
  @ApiOperation({ summary: 'Set a saved payment method as the default' })
  @UseGuards(JwtAuthGuard)
  setDefaultSavedMethod(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
  ) {
    return this.paymentService.setDefaultSavedMethod(user.sub, id);
  }

  @Delete('saved-methods/:id')
  @ApiBearerAuth(SWAGGER_JWT_AUTH)
  @ApiOperation({
    summary: 'Remove a saved payment method',
    description:
      'Detaches the method from the provider (Stripe / PayPal) and deletes the local record.',
  })
  @HttpCode(204)
  @UseGuards(JwtAuthGuard)
  async deleteSavedMethod(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
  ) {
    await this.paymentService.deleteSavedMethod(user.sub, id);
  }
}
