import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, FindOptionsWhere } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import axios from 'axios';
import Stripe from 'stripe';
import { Order } from '../orders/entities/order.entity';
import { OrdersService } from '../orders/orders.service';
import { NotificationsService } from '../notifications/notifications.service';
import { PaymentProvider } from '../common/enums/payment-provider.enum';
import { OrderStatus } from '../common/enums/order-status.enum';
import { amountToMinorUnits } from '../payment/utils/amount-minor-units.util';
import { Refund } from './entities/refund.entity';
import { CustomerIssue } from './entities/customer-issue.entity';
import { RefundStatus } from './enums/refund-status.enum';
import { IssueStatus } from './enums/issue-status.enum';
import { CreateRefundDto } from './dto/create-refund.dto';
import { CreateIssueDto } from './dto/create-issue.dto';
import { PatchIssueDto } from './dto/patch-issue.dto';
import { ListIssuesDto } from './dto/list-issues.dto';
import { CreatePriceDisputeDto } from './dto/create-price-dispute.dto';
import { ListMyIssuesDto } from './dto/list-my-issues.dto';
import { IssuePriority, IssueType } from './enums/issue-status.enum';
import { QUEUE_VERIFY_PRICE } from '../jobs/queue.constants';

@Injectable()
export class ReconciliationService {
  private readonly logger = new Logger(ReconciliationService.name);
  private stripe: Stripe | null = null;

  constructor(
    @InjectRepository(Refund)
    private readonly refunds: Repository<Refund>,
    @InjectRepository(CustomerIssue)
    private readonly issues: Repository<CustomerIssue>,
    @InjectRepository(Order)
    private readonly orders: Repository<Order>,
    @InjectQueue(QUEUE_VERIFY_PRICE)
    private readonly verifyPriceQueue: Queue<{ productId: string }>,
    private readonly ordersService: OrdersService,
    private readonly notifications: NotificationsService,
    private readonly config: ConfigService,
  ) {}

  // ---------------------------------------------------------------------------
  // Stripe helpers (shared pattern with PaymentService)
  // ---------------------------------------------------------------------------

  private getStripe(): Stripe {
    const key = this.config.get<string>('STRIPE_SECRET_KEY');
    if (!key) throw new BadRequestException('Stripe is not configured');
    if (!this.stripe) this.stripe = new Stripe(key);
    return this.stripe;
  }

  private paystackSecret(): string {
    const key = this.config.get<string>('PAYSTACK_SECRET_KEY');
    if (!key) throw new BadRequestException('Paystack is not configured');
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

  private async paypalAccessToken(): Promise<string> {
    const clientId = this.config.get<string>('PAYPAL_CLIENT_ID')?.trim();
    const secret =
      this.config.get<string>('PAYPAL_SECRET_KEY')?.trim() ||
      this.config.get<string>('PAYPAL_CLIENT_SECRET')?.trim();
    if (!clientId || !secret) {
      throw new BadRequestException('PayPal is not configured');
    }
    const basic = Buffer.from(`${clientId}:${secret}`).toString('base64');
    const { data } = await axios.post<{ access_token?: string }>(
      `${this.paypalBaseUrl()}/v1/oauth2/token`,
      'grant_type=client_credentials',
      {
        headers: {
          Authorization: `Basic ${basic}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
      },
    );
    const token = data?.access_token;
    if (!token)
      throw new BadRequestException('Could not authenticate with PayPal');
    return token;
  }

  // ---------------------------------------------------------------------------
  // Refunds
  // ---------------------------------------------------------------------------

  async issueRefund(
    dto: CreateRefundDto,
    adminUserId: string,
  ): Promise<Refund> {
    const order = await this.ordersService.findById(dto.orderId);

    if (order.status === OrderStatus.REFUNDED) {
      throw new BadRequestException('Order has already been refunded');
    }
    if (order.status === OrderStatus.PENDING) {
      throw new BadRequestException('Cannot refund an unpaid order');
    }

    const orderTotal = parseFloat(order.total);
    const refundAmount = dto.amount ?? orderTotal;

    if (refundAmount > orderTotal) {
      throw new BadRequestException(
        `Refund amount (${refundAmount}) exceeds order total (${orderTotal})`,
      );
    }

    // Persist the refund record as PROCESSING so we can update it from the result.
    const refund = this.refunds.create({
      orderId: order.id,
      amount: refundAmount.toFixed(2),
      currency: order.currency,
      status: RefundStatus.PROCESSING,
      reason: dto.reason ?? null,
      internalNote: dto.internalNote ?? null,
      initiatedBy: adminUserId,
    });
    await this.refunds.save(refund);

    try {
      const provider = order.paymentProvider as PaymentProvider | null;
      await this.dispatchRefundToProvider(
        refund,
        order,
        provider,
        refundAmount,
      );
    } catch (err: unknown) {
      refund.status = RefundStatus.FAILED;
      refund.failedReason = err instanceof Error ? err.message : String(err);
      await this.refunds.save(refund);
      this.logger.error(
        `[reconciliation] refund_failed refundId=${refund.id} orderId=${order.id}`,
        err instanceof Error ? err.stack : String(err),
      );
      throw err;
    }

    // Mark the order as refunded only on full refund.
    const isFullRefund = refundAmount >= orderTotal;
    if (isFullRefund) {
      order.status = OrderStatus.REFUNDED;
      await this.orders.save(order);
    }

    // Notify customer.
    const customerEmail = order.user?.email;
    if (customerEmail) {
      this.notifications
        .sendEmail({
          to: customerEmail,
          subject: `Refund initiated for order ${order.id}`,
          text:
            `A refund of ${order.currency} ${refundAmount.toFixed(2)} has been initiated for your order.` +
            (dto.reason ? ` Reason: ${dto.reason}` : '') +
            ' Please allow 3–10 business days for the funds to appear.',
        })
        .catch((e: unknown) =>
          this.logger.error(
            `[reconciliation] refund_email_failed orderId=${order.id}`,
            e instanceof Error ? e.stack : String(e),
          ),
        );
    }

    this.logger.log(
      `[reconciliation] refund_issued refundId=${refund.id} orderId=${order.id} ` +
        `amount=${refundAmount} provider=${order.paymentProvider ?? 'manual'} ` +
        `status=${refund.status}`,
    );

    return refund;
  }

  private async dispatchRefundToProvider(
    refund: Refund,
    order: {
      id: string;
      stripePaymentIntentId: string | null;
      paystackReference: string | null;
      paymentMethodDetails: Record<string, unknown> | null;
      currency: string;
    },
    provider: PaymentProvider | null,
    amount: number,
  ): Promise<void> {
    switch (provider) {
      case PaymentProvider.STRIPE:
        await this.refundViaStripe(refund, order, amount);
        break;
      case PaymentProvider.PAYSTACK:
        await this.refundViaPaystack(refund, order, amount);
        break;
      case PaymentProvider.PAYPAL:
        await this.refundViaPaypal(refund, order, amount);
        break;
      default:
        // Myaza crypto refunds or unknown providers require manual processing.
        refund.status = RefundStatus.MANUAL_REQUIRED;
        refund.internalNote = [
          refund.internalNote,
          `Provider "${provider ?? 'unknown'}" does not support automated refunds. Manual action required.`,
        ]
          .filter(Boolean)
          .join(' | ');
        await this.refunds.save(refund);
        return;
    }
  }

  private async refundViaStripe(
    refund: Refund,
    order: {
      id: string;
      stripePaymentIntentId: string | null;
      currency: string;
    },
    amount: number,
  ): Promise<void> {
    if (!order.stripePaymentIntentId) {
      throw new BadRequestException(
        'No Stripe payment intent found for this order',
      );
    }
    const stripe = this.getStripe();
    const stripeRefund = await stripe.refunds.create({
      payment_intent: order.stripePaymentIntentId,
      amount: amountToMinorUnits(amount.toFixed(2), order.currency),
    });
    // Stripe status values: pending | requires_action | succeeded | failed | canceled
    refund.status =
      stripeRefund.status === 'succeeded'
        ? RefundStatus.SUCCEEDED
        : stripeRefund.status === 'failed' || stripeRefund.status === 'canceled'
          ? RefundStatus.FAILED
          : RefundStatus.PROCESSING;
    refund.providerRefundId = stripeRefund.id;
    refund.providerResponse = stripeRefund as unknown as Record<
      string,
      unknown
    >;
    await this.refunds.save(refund);
  }

  private async refundViaPaystack(
    refund: Refund,
    order: { id: string; paystackReference: string | null; currency: string },
    amount: number,
  ): Promise<void> {
    if (!order.paystackReference) {
      throw new BadRequestException(
        'No Paystack reference found for this order',
      );
    }
    const { data } = await axios.post<{
      status: boolean;
      data?: { id?: number; status?: string };
    }>(
      'https://api.paystack.co/refund',
      {
        transaction: order.paystackReference,
        amount: amountToMinorUnits(amount.toFixed(2), order.currency),
      },
      {
        headers: {
          Authorization: `Bearer ${this.paystackSecret()}`,
          'Content-Type': 'application/json',
        },
      },
    );
    if (!data.status) {
      throw new BadRequestException('Paystack refund request failed');
    }
    refund.status = RefundStatus.PROCESSING; // Paystack refunds are async
    refund.providerRefundId = data.data?.id ? String(data.data.id) : null;
    refund.providerResponse = data as unknown as Record<string, unknown>;
    await this.refunds.save(refund);
  }

  private async refundViaPaypal(
    refund: Refund,
    order: {
      id: string;
      paymentMethodDetails: Record<string, unknown> | null;
      currency: string;
    },
    amount: number,
  ): Promise<void> {
    const captureId = order.paymentMethodDetails?.paypalCaptureId as
      | string
      | undefined;
    if (!captureId) {
      throw new BadRequestException(
        'No PayPal capture ID found for this order',
      );
    }
    const token = await this.paypalAccessToken();
    const { data } = await axios.post<{ id?: string; status?: string }>(
      `${this.paypalBaseUrl()}/v2/payments/captures/${captureId}/refund`,
      {
        amount: {
          value: amount.toFixed(2),
          currency_code: order.currency.toUpperCase(),
        },
      },
      {
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          // PayPal-Request-Id makes the call idempotent — safe to retry on timeout
          // without creating a duplicate refund. We use the refund UUID as the key.
          'PayPal-Request-Id': refund.id,
        },
      },
    );
    // PayPal status values: COMPLETED | PENDING | DECLINED | FAILED | PARTIALLY_REFUNDED | REFUNDED
    refund.status =
      data.status === 'COMPLETED'
        ? RefundStatus.SUCCEEDED
        : data.status === 'DECLINED' || data.status === 'FAILED'
          ? RefundStatus.FAILED
          : RefundStatus.PROCESSING;
    refund.providerRefundId = data.id ?? null;
    refund.providerResponse = data as Record<string, unknown>;
    await this.refunds.save(refund);
  }

  async listRefunds(orderId?: string): Promise<Refund[]> {
    const where: FindOptionsWhere<Refund> = orderId ? { orderId } : {};
    return this.refunds.find({
      where,
      order: { createdAt: 'DESC' },
      take: 500,
    });
  }

  async getRefund(refundId: string): Promise<Refund> {
    const r = await this.refunds.findOne({ where: { id: refundId } });
    if (!r) throw new NotFoundException('Refund not found');
    return r;
  }

  // ---------------------------------------------------------------------------
  // Customer Issues
  // ---------------------------------------------------------------------------

  async createIssue(dto: CreateIssueDto): Promise<CustomerIssue> {
    const issue = this.issues.create({
      orderId: dto.orderId ?? null,
      userId: dto.userId,
      type: dto.type,
      priority: dto.priority,
      subject: dto.subject,
      description: dto.description,
      internalNote: dto.internalNote ?? null,
      assignedTo: dto.assignedTo ?? null,
    });
    await this.issues.save(issue);
    this.logger.log(
      `[reconciliation] issue_created issueId=${issue.id} type=${issue.type} userId=${issue.userId}`,
    );
    return issue;
  }

  async patchIssue(
    issueId: string,
    dto: PatchIssueDto,
  ): Promise<CustomerIssue> {
    const issue = await this.issues.findOne({ where: { id: issueId } });
    if (!issue) throw new NotFoundException('Issue not found');

    if (dto.status !== undefined) issue.status = dto.status;
    if (dto.priority !== undefined) issue.priority = dto.priority;
    if (dto.resolutionNote !== undefined)
      issue.resolutionNote = dto.resolutionNote;
    if (dto.internalNote !== undefined) issue.internalNote = dto.internalNote;
    if (dto.assignedTo !== undefined) issue.assignedTo = dto.assignedTo;

    const isBeingResolved =
      dto.status !== undefined &&
      (dto.status === IssueStatus.RESOLVED ||
        dto.status === IssueStatus.CLOSED) &&
      issue.resolvedAt === null;

    if (isBeingResolved) {
      issue.resolvedAt = new Date();
    }

    await this.issues.save(issue);
    this.logger.log(
      `[reconciliation] issue_updated issueId=${issue.id} status=${issue.status}`,
    );
    return issue;
  }

  async listIssues(
    filters: ListIssuesDto,
  ): Promise<{ total: number; items: CustomerIssue[] }> {
    const where: FindOptionsWhere<CustomerIssue> = {};
    if (filters.status) where.status = filters.status;
    if (filters.type) where.type = filters.type;
    if (filters.priority) where.priority = filters.priority;
    if (filters.userId) where.userId = filters.userId;
    if (filters.orderId) where.orderId = filters.orderId;

    const [items, total] = await this.issues.findAndCount({
      where,
      order: { createdAt: 'DESC' },
      take: filters.limit ?? 50,
      skip: filters.offset ?? 0,
    });

    return { total, items };
  }

  async getIssue(issueId: string): Promise<CustomerIssue> {
    const issue = await this.issues.findOne({
      where: { id: issueId },
      relations: ['order', 'user'],
    });
    if (!issue) throw new NotFoundException('Issue not found');
    return issue;
  }

  async requestPriceVerification(
    userId: string,
    dto: CreatePriceDisputeDto,
  ): Promise<{ issue: CustomerIssue; queuedVerificationJobs: number }> {
    const order = await this.orders.findOne({
      where: { id: dto.orderId, userId },
      relations: ['items'],
    });
    if (!order) {
      throw new NotFoundException('Order not found');
    }

    const subject = `Price verification request for order ${order.id}`;
    const expectedTotalBlock =
      dto.expectedTotal != null
        ? `\nExpected total: ${dto.expectedTotal.toFixed(2)}`
        : '';
    const reasonBlock = dto.reason?.trim()
      ? `\nCustomer reason: ${dto.reason.trim()}`
      : '';
    const description =
      `Requested verification for charged total ${order.currency} ${order.total}.` +
      expectedTotalBlock +
      reasonBlock;

    const issue = this.issues.create({
      orderId: order.id,
      userId,
      type: IssueType.BILLING_ERROR,
      priority: IssuePriority.HIGH,
      subject,
      description,
      internalNote: 'Auto-created via buyer price verification endpoint.',
      assignedTo: null,
    });
    await this.issues.save(issue);

    const uniqueProductIds = [
      ...new Set(
        (order.items ?? [])
          .map((item) => item.productId)
          .filter(
            (id): id is string => typeof id === 'string' && id.length > 0,
          ),
      ),
    ];
    for (const productId of uniqueProductIds) {
      await this.verifyPriceQueue.add(
        'verify',
        { productId },
        {
          jobId: `price_dispute:${issue.id}:${productId}`,
          removeOnComplete: true,
          attempts: 2,
          backoff: { type: 'exponential', delay: 5000 },
        },
      );
    }

    this.logger.log(
      `[reconciliation] price_verification_requested issueId=${issue.id} orderId=${order.id} userId=${userId} queuedJobs=${uniqueProductIds.length}`,
    );
    return { issue, queuedVerificationJobs: uniqueProductIds.length };
  }

  async listMyIssues(
    userId: string,
    filters: ListMyIssuesDto,
  ): Promise<{ total: number; items: CustomerIssue[] }> {
    const where: FindOptionsWhere<CustomerIssue> = { userId };
    if (filters.status) where.status = filters.status;
    if (filters.orderId) where.orderId = filters.orderId;

    const [items, total] = await this.issues.findAndCount({
      where,
      order: { createdAt: 'DESC' },
      take: filters.limit ?? 20,
      skip: filters.offset ?? 0,
    });

    return { total, items };
  }

  async getMyIssue(userId: string, issueId: string): Promise<CustomerIssue> {
    const issue = await this.issues.findOne({
      where: { id: issueId, userId },
      relations: ['order'],
    });
    if (!issue) throw new NotFoundException('Issue not found');
    return issue;
  }

  /**
   * Convenience: resolve a customer issue and issue a refund in one operation.
   * The issue is marked RESOLVED and linked to the resulting refund record.
   */
  async resolveIssueWithRefund(
    issueId: string,
    refundDto: CreateRefundDto,
    adminUserId: string,
  ): Promise<{ issue: CustomerIssue; refund: Refund }> {
    const issue = await this.issues.findOne({ where: { id: issueId } });
    if (!issue) throw new NotFoundException('Issue not found');

    const refund = await this.issueRefund(refundDto, adminUserId);

    issue.status = IssueStatus.RESOLVED;
    issue.resolvedAt = new Date();
    issue.refundId = refund.id;
    if (!issue.resolutionNote) {
      issue.resolutionNote = `Refund of ${refundDto.amount ?? 'full amount'} issued.`;
    }
    await this.issues.save(issue);

    return { issue, refund };
  }
}
