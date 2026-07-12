import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Cron, CronExpression } from '@nestjs/schedule';
import { DataSource, In, IsNull, LessThan, Repository } from 'typeorm';
import { Batch } from './entities/batch.entity';
import { WannaBuyItem } from './entities/wanna-buy-item.entity';
import { BatchStatus } from '../common/enums/batch-status.enum';
import { WannaBuyItemStatus } from '../common/enums/wanna-buy-item-status.enum';
import { CurrencyService } from '../currency/currency.service';
import { NotificationsService } from '../notifications/notifications.service';
import { UsersService } from '../users/users.service';
import type { AddWannaBuyItemDto } from './dto/add-wanna-buy-item.dto';
import type { AdminQuoteWannaBuyItemDto } from './dto/admin-quote-wanna-buy-item.dto';
import { detectProductSource } from '../scraper/utils/detect-source.util';
import { ProductSource } from '../common/enums/product-source.enum';
import { computePlatformFee } from '../common/utils/pricing.util';
import { getNextWeeklyCutoff } from './utils/collecting-cutoff.util';
import {
  assertTransition,
  BATCH_STATUS_TRANSITIONS,
  UNPAID_ITEM_STATUSES,
  WANNA_BUY_ITEM_TRANSITIONS,
} from './utils/status-transitions.util';
import type { BatchRolloverInfo } from './interfaces/batch-rollover-info.interface';
import { Order } from '../orders/entities/order.entity';
import { OrderItem } from '../orders/entities/order-item.entity';
import { OrderStatus } from '../common/enums/order-status.enum';
import type { ShippingAddress } from '../users/entities/user.entity';
import { OrderRealtimeService } from '../realtime/order-realtime.service';
import { EmailTemplateService } from '../notifications/email-templates.service';
import { ConfigService } from '@nestjs/config';
import { resolveFrontendBaseUrl } from '../common/utils/frontend-url.util';
import { ReconciliationService } from '../reconciliation/reconciliation.service';

const PAYMENT_REMINDER_DELAY_HOURS = 24;

function round(n: number): number {
  return Math.round(n * 100) / 100;
}

@Injectable()
export class WannaBuyService {
  private readonly logger = new Logger(WannaBuyService.name);

  constructor(
    @InjectRepository(Batch)
    private readonly batches: Repository<Batch>,
    @InjectRepository(WannaBuyItem)
    private readonly items: Repository<WannaBuyItem>,
    private readonly currency: CurrencyService,
    private readonly notifications: NotificationsService,
    private readonly users: UsersService,
    private readonly dataSource: DataSource,
    private readonly orderRealtime: OrderRealtimeService,
    private readonly emailTemplates: EmailTemplateService,
    private readonly config: ConfigService,
    private readonly reconciliation: ReconciliationService,
  ) {}

  // ── User endpoints ──────────────────────────────────────────────────────────

  /**
   * No scraping here — admins price these manually via `saveQuote`. Scraping only
   * happens on the storefront's product import flow, which is where users expect
   * to wait for it; Wanna Buy adds must stay instant.
   */
  async addItem(
    userId: string,
    dto: AddWannaBuyItemDto,
  ): Promise<WannaBuyItem & { batchRollover: BatchRolloverInfo | null }> {
    const { batch, rolledOverFrom } = await this.resolveCollectingBatch();
    const marketplace: ProductSource = detectProductSource(dto.productUrl);

    const item = this.items.create({
      userId,
      batchId: batch.id,
      productUrl: dto.productUrl,
      productTitle: dto.productTitle ?? null,
      imageUrl: dto.imageUrl ?? null,
      marketplace,
      variantSelection: dto.variantSelection ?? null,
      scrapedPriceUsd: null,
      status: WannaBuyItemStatus.PENDING,
    });

    const saved = await this.items.save(item);
    this.logger.log(`[wanna-buy] item=${saved.id} added by user=${userId} batch=${batch.id}`);

    let batchRollover: BatchRolloverInfo | null = null;
    if (rolledOverFrom) {
      batchRollover = {
        previousBatchLabel: this.batchLabel(rolledOverFrom),
        newBatchLabel: this.batchLabel(batch),
        collectingEndsAt: batch.collectingEndsAt?.toISOString() ?? null,
      };
      void this.sendBatchRolloverEmail(userId, saved, batchRollover).catch((err) => {
        this.logger.warn(
          `[wanna-buy] rollover email failed for item=${saved.id}: ${err instanceof Error ? err.message : String(err)}`,
        );
      });
    }

    return { ...saved, batchRollover };
  }

  async listUserItems(userId: string): Promise<WannaBuyItem[]> {
    return this.items.find({
      where: { userId },
      order: { createdAt: 'DESC' },
    });
  }

  /**
   * Lets a user remove an item from their own list before it's gone anywhere —
   * once it's `confirmed` an Order already exists, so removal from there on
   * would mean touching payment/refund logic, not just this record.
   */
  async cancelItem(userId: string, itemId: string): Promise<WannaBuyItem> {
    const item = await this.items.findOne({ where: { id: itemId, userId } });
    if (!item) throw new NotFoundException(`WannaBuyItem ${itemId} not found`);

    if (item.status !== WannaBuyItemStatus.PENDING && item.status !== WannaBuyItemStatus.QUOTED) {
      throw new BadRequestException(
        `Only pending or quoted items can be removed. This item is already "${item.status}".`,
      );
    }

    item.status = WannaBuyItemStatus.CANCELLED;
    const saved = await this.items.save(item);

    this.orderRealtime.emitWannaBuyUpdate(userId, { itemId: saved.id, status: saved.status });
    this.logger.log(`[wanna-buy] item=${itemId} cancelled by user=${userId}`);

    return saved;
  }

  /** Read-only — unlike `resolveCollectingBatch`, never opens a new batch as a side effect of a GET. */
  async getCurrentOpenBatch(): Promise<Batch | null> {
    const mostRecent = await this.mostRecentBatch();
    return this.isBatchOpen(mostRecent) ? mostRecent : null;
  }

  // ── Admin endpoints ─────────────────────────────────────────────────────────

  async listBatches(): Promise<Batch[]> {
    return this.batches.find({ order: { createdAt: 'DESC' } });
  }

  async getBatchItems(batchId: string): Promise<WannaBuyItem[]> {
    const batch = await this.batches.findOne({ where: { id: batchId } });
    if (!batch) throw new NotFoundException(`Batch ${batchId} not found`);
    return this.items.find({
      where: { batchId },
      order: { createdAt: 'ASC' },
    });
  }

  async createBatch(label?: string): Promise<Batch> {
    const batch = this.batches.create({
      status: BatchStatus.COLLECTING,
      label: label ?? null,
    });
    return this.batches.save(batch);
  }

  /**
   * `resolveUnpaid: 'reassign'` is only meaningful (and only checked) on the
   * Processing → Placing Orders move — that's the point real money gets spent,
   * so it's the only transition gated on payment. Without it, that move throws
   * a 409 listing the unpaid items instead of silently including them.
   */
  async advanceBatchStatus(
    batchId: string,
    status: BatchStatus,
    resolveUnpaid?: 'reassign',
  ): Promise<Batch> {
    const batch = await this.batches.findOne({ where: { id: batchId } });
    if (!batch) throw new NotFoundException(`Batch ${batchId} not found`);

    assertTransition(BATCH_STATUS_TRANSITIONS, batch.status, status);

    if (status === BatchStatus.PLACING_ORDERS) {
      const unpaidItems = await this.items.find({
        where: { batchId, status: In(UNPAID_ITEM_STATUSES) },
      });

      if (unpaidItems.length > 0) {
        if (resolveUnpaid !== 'reassign') {
          throw new ConflictException({
            message: `${unpaidItems.length} item(s) in this batch are still unpaid.`,
            unpaidCount: unpaidItems.length,
            unpaidItems: unpaidItems.map((i) => ({
              id: i.id,
              productTitle: i.productTitle ?? i.productUrl,
              userId: i.userId,
            })),
          });
        }

        const { batch: nextBatch } = await this.resolveCollectingBatch();
        for (const item of unpaidItems) {
          const rollover: BatchRolloverInfo = {
            previousBatchLabel: this.batchLabel(batch),
            newBatchLabel: this.batchLabel(nextBatch),
            collectingEndsAt: nextBatch.collectingEndsAt?.toISOString() ?? null,
          };
          item.batchId = nextBatch.id;
          await this.items.save(item);
          this.orderRealtime.emitWannaBuyUpdate(item.userId, { itemId: item.id, status: item.status });
          void this.sendBatchRolloverEmail(item.userId, item, rollover).catch((err) => {
            this.logger.warn(
              `[wanna-buy] reassignment rollover email failed for item=${item.id}: ${err instanceof Error ? err.message : String(err)}`,
            );
          });
        }
        this.logger.log(
          `[wanna-buy] batch=${batchId} → placing_orders: reassigned ${unpaidItems.length} unpaid item(s) to batch=${nextBatch.id}`,
        );
      }
    }

    batch.status = status;
    const now = new Date();
    if (status === BatchStatus.PROCESSING) batch.processingStartedAt = now;
    else if (status === BatchStatus.PLACING_ORDERS) batch.placingOrdersAt = now;
    else if (status === BatchStatus.IN_TRANSIT) batch.inTransitAt = now;
    else if (status === BatchStatus.AT_WAREHOUSE) batch.atWarehouseAt = now;
    else if (status === BatchStatus.SHIPPED) batch.shippedAt = now;
    else if (status === BatchStatus.DELIVERED) batch.deliveredAt = now;

    const saved = await this.batches.save(batch);

    if (status === BatchStatus.PLACING_ORDERS) {
      const paidItems = await this.items.find({ where: { batchId, status: WannaBuyItemStatus.PAID } });
      for (const item of paidItems) {
        item.status = WannaBuyItemStatus.ORDERED;
        await this.items.save(item);
        this.orderRealtime.emitWannaBuyUpdate(item.userId, { itemId: item.id, status: item.status });
      }
    }

    return saved;
  }

  /** Admin-triggered — sends the payment nudge to every quoted-but-unpaid item in a batch right now, bypassing the cron's dedup. */
  async nudgeUnpaidBatchItems(batchId: string): Promise<{ nudged: number }> {
    const batch = await this.batches.findOne({ where: { id: batchId } });
    if (!batch) throw new NotFoundException(`Batch ${batchId} not found`);

    const items = await this.items.find({
      where: { batchId, status: WannaBuyItemStatus.QUOTED },
    });
    for (const item of items) {
      await this.sendPaymentNudge(item);
    }
    return { nudged: items.length };
  }

  /** Fixed-delay, once — quoted items unpaid `PAYMENT_REMINDER_DELAY_HOURS` after the quote email, not yet reminded. */
  @Cron(CronExpression.EVERY_30_MINUTES)
  async sendPaymentReminders(): Promise<void> {
    const cutoff = new Date(Date.now() - PAYMENT_REMINDER_DELAY_HOURS * 60 * 60 * 1000);
    const items = await this.items.find({
      where: {
        status: WannaBuyItemStatus.QUOTED,
        notifiedAt: LessThan(cutoff),
        reminderSentAt: IsNull(),
      },
    });
    for (const item of items) {
      try {
        await this.sendPaymentNudge(item);
      } catch (err) {
        this.logger.warn(
          `[wanna-buy] payment nudge failed for item=${item.id}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
    if (items.length > 0) {
      this.logger.log(`[wanna-buy] payment reminder sweep: nudged ${items.length} item(s)`);
    }
  }

  async saveQuote(
    itemId: string,
    dto: AdminQuoteWannaBuyItemDto,
    adminUserId: string,
  ): Promise<WannaBuyItem> {
    const item = await this.items.findOne({
      where: { id: itemId },
      relations: ['user'],
    });
    if (!item) throw new NotFoundException(`WannaBuyItem ${itemId} not found`);

    // Was this a rough, price-only upfront estimate before this save? If so, and it's
    // already been paid, we may owe the customer a refund once this save finalizes it.
    const wasEstimate = item.isEstimateQuote;

    if (dto.adminPriceUsd !== undefined) {
      item.adminPriceUsd = String(dto.adminPriceUsd);
      if (dto.priceEditNote) item.priceEditNote = dto.priceEditNote;
    }
    if (dto.taxAmountUsd !== undefined) {
      item.taxAmountUsd = String(dto.taxAmountUsd);
    }
    if (dto.kingzShippingUsd !== undefined) {
      item.kingzShippingUsd = String(dto.kingzShippingUsd);
    }
    if (dto.productTitle !== undefined) {
      item.productTitle = dto.productTitle;
    }
    if (dto.imageUrl !== undefined) {
      item.imageUrl = dto.imageUrl;
    }
    if (dto.isEstimateQuote !== undefined) {
      item.isEstimateQuote = dto.isEstimateQuote;
    }

    // Recompute totals whenever any pricing field changes
    const effectivePriceUsd = parseFloat(
      (item.adminPriceUsd ?? item.scrapedPriceUsd) ?? '0',
    );
    if (effectivePriceUsd > 0) {
      const platformFee = computePlatformFee(effectivePriceUsd);
      const tax = parseFloat(item.taxAmountUsd ?? '0');
      const kingzShipping = parseFloat(item.kingzShippingUsd ?? '0');
      const fxBuffer = 0;

      item.platformFeeUsd = String(platformFee);
      item.fxBufferUsd = String(fxBuffer);

      const totalUsd = round(effectivePriceUsd + tax + platformFee + kingzShipping + fxBuffer);
      item.totalUsd = String(totalUsd);

      try {
        const totalNgn = round(await this.currency.convert(totalUsd, 'USD', 'NGN'));
        item.totalNgn = String(totalNgn);
      } catch (err) {
        this.logger.warn(`[wanna-buy] NGN conversion failed: ${err instanceof Error ? err.message : String(err)}`);
      }

      if (item.status === WannaBuyItemStatus.PENDING) {
        assertTransition(WANNA_BUY_ITEM_TRANSITIONS, item.status, WannaBuyItemStatus.QUOTED);
        item.status = WannaBuyItemStatus.QUOTED;
      }
    }

    // Finalizing a previously-estimated, already-paid item: reconcile what was charged
    // against the real total. Only refunds are automated (undercharge is flagged for
    // manual follow-up) per the agreed scope.
    if (wasEstimate && !item.isEstimateQuote && item.chargedTotalUsd != null) {
      const chargedTotalUsd = parseFloat(item.chargedTotalUsd);
      const finalTotalUsd = parseFloat(item.totalUsd ?? '0');
      const delta = round(chargedTotalUsd - finalTotalUsd);

      if (delta > 0 && item.orderId) {
        try {
          await this.reconciliation.issueRefund(
            {
              orderId: item.orderId,
              amount: delta,
              reason: 'Wanna Buy quote finalized below the upfront estimate',
            },
            adminUserId,
          );
          this.logger.log(
            `[wanna-buy] estimate refund issued item=${item.id} order=${item.orderId} amount=${delta}`,
          );
        } catch (err) {
          this.logger.warn(
            `[wanna-buy] estimate refund failed item=${item.id} order=${item.orderId}: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      } else if (delta < 0) {
        this.logger.warn(
          `[wanna-buy] final quote exceeds upfront estimate — manual follow-up needed item=${item.id} order=${item.orderId} shortfall=${-delta}`,
        );
      }

      item.quoteFinalizedAt = new Date();
    }

    const saved = await this.items.save(item);

    if (dto.notifyUser) {
      try {
        await this.sendQuoteNotification(saved);
      } catch (err) {
        // Quote is already saved and marked QUOTED above — for now, don't fail the admin's save if the email send errors out.
        this.logger.warn(`[wanna-buy] quote notification failed for item=${saved.id}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    return saved;
  }

  /**
   * Creates ONE Order (with one OrderItem per WannaBuyItem) so the user can pay
   * for several quoted items in a single payment through the existing payment
   * rail (Paystack / Stripe). Every item must be `quoted` and belong to the
   * requesting user.
   *
   * Returns the newly-created Order. The caller (controller) then directs the
   * frontend to `/checkout?resume=<orderId>` so it can use the existing payment
   * provider selection + webhook flow without any changes.
   */
  async createOrderForPayment(itemIds: string[], userId: string): Promise<Order> {
    const items = await this.items.find({
      where: { id: In(itemIds), userId },
      relations: ['user'],
    });
    if (items.length !== itemIds.length) {
      throw new NotFoundException('One or more WannaBuyItems were not found');
    }
    for (const item of items) {
      assertTransition(WANNA_BUY_ITEM_TRANSITIONS, item.status, WannaBuyItemStatus.CONFIRMED);
      if (!item.totalUsd) {
        throw new BadRequestException(
          `Quote for "${item.productTitle ?? item.productUrl}" has not been fully computed yet`,
        );
      }
    }

    const user = items[0].user ?? (await this.users.findById(userId));
    if (!user.defaultShippingAddress) {
      throw new BadRequestException(
        'No default shipping address on file. Please add one in your profile before paying.',
      );
    }
    const shippingAddress = user.defaultShippingAddress as ShippingAddress;

    let subtotal = 0;
    let tax = 0;
    let platformFee = 0;
    let shipping = 0;
    let fxBuffer = 0;
    let total = 0;
    const breakdown: string[] = [];

    for (const item of items) {
      const effectivePriceUsd = parseFloat((item.adminPriceUsd ?? item.scrapedPriceUsd) ?? '0');
      const taxUsd = parseFloat(item.taxAmountUsd ?? '0');
      const platformFeeUsd = parseFloat(item.platformFeeUsd ?? '0');
      const kingzShippingUsd = parseFloat(item.kingzShippingUsd ?? '0');
      const fxBufferUsd = parseFloat(item.fxBufferUsd ?? '0');
      const itemTotalUsd = parseFloat(item.totalUsd ?? '0');

      subtotal += effectivePriceUsd;
      tax += taxUsd;
      platformFee += platformFeeUsd;
      shipping += kingzShippingUsd;
      fxBuffer += fxBufferUsd;
      total += itemTotalUsd;

      breakdown.push(`${item.productTitle ?? item.productUrl}: $${itemTotalUsd.toFixed(2)}`);
    }
    breakdown.push(`─────────────────────────────`, `Total (USD): $${round(total).toFixed(2)}`);

    const order = await this.dataSource.transaction(async (em) => {
      const o = em.create(Order, {
        userId,
        status: OrderStatus.PENDING,
        subtotal: round(subtotal).toFixed(2),
        fees: round(platformFee).toFixed(2),
        discount: '0.00',
        shippingFee: round(shipping).toFixed(2),
        marketplaceTax: round(tax).toFixed(2),
        marketplaceShipping: '0.00',
        domesticHandling: '0.00',
        customsTotal: '0.00',
        fxBuffer: round(fxBuffer).toFixed(2),
        riskBuffer: '0.00',
        pricingBreakdown: breakdown,
        total: round(total).toFixed(2),
        currency: 'USD',
        shippingAddress,
      });
      await em.save(o);

      for (const item of items) {
        const effectivePriceUsd = parseFloat((item.adminPriceUsd ?? item.scrapedPriceUsd) ?? '0');
        await em.save(
          em.create(OrderItem, {
            orderId: o.id,
            productId: null,
            titleSnapshot: item.productTitle ?? item.productUrl,
            priceSnapshot: effectivePriceUsd.toFixed(2),
            currencySnapshot: 'USD',
            quantity: 1,
            imagesSnapshot: item.imageUrl ? [item.imageUrl] : [],
            variantSnapshot: item.variantSelection,
          }),
        );
      }

      return o;
    });

    const now = new Date();
    for (const item of items) {
      item.orderId = order.id;
      item.status = WannaBuyItemStatus.CONFIRMED;
      item.confirmedAt = now;
    }
    await this.items.save(items);

    for (const item of items) {
      this.orderRealtime.emitWannaBuyUpdate(item.userId, {
        itemId: item.id,
        status: item.status,
      });
    }

    this.logger.log(
      `[wanna-buy] order=${order.id} created for ${items.length} item(s) user=${userId} total=${round(total)}`,
    );

    return order;
  }

  // ── Internal helpers ────────────────────────────────────────────────────────

  /** `findOne({ order })` with no `where` throws in this TypeORM version — `find` + `take: 1` is the correct way to get "the latest row". */
  private async mostRecentBatch(): Promise<Batch | null> {
    const [batch] = await this.batches.find({ order: { createdAt: 'DESC' }, take: 1 });
    return batch ?? null;
  }

  private isBatchOpen(batch: Batch | null): batch is Batch {
    if (!batch || batch.status !== BatchStatus.COLLECTING) return false;
    if (!batch.collectingEndsAt) return true; // legacy batch, no cutoff — always open
    return batch.collectingEndsAt.getTime() > Date.now();
  }

  private batchLabel(batch: Batch): string {
    return batch.label ?? `Batch ${batch.id.slice(0, 8)}`;
  }

  /**
   * Finds the batch new items should join. If the most recent batch is still
   * open (collecting + before its cutoff), reuse it. Otherwise open a fresh one
   * and report what it replaced so the caller can notify the user of the rollover.
   */
  private async resolveCollectingBatch(): Promise<{ batch: Batch; rolledOverFrom: Batch | null }> {
    const mostRecent = await this.mostRecentBatch();
    if (this.isBatchOpen(mostRecent)) {
      return { batch: mostRecent, rolledOverFrom: null };
    }

    const batch = await this.batches.save(
      this.batches.create({
        status: BatchStatus.COLLECTING,
        collectingEndsAt: getNextWeeklyCutoff(new Date()),
      }),
    );
    return { batch, rolledOverFrom: mostRecent ?? null };
  }

  private async sendBatchRolloverEmail(
    userId: string,
    item: WannaBuyItem,
    rollover: BatchRolloverInfo,
  ): Promise<void> {
    const user = await this.users.findById(userId);
    if (!user?.email) {
      this.logger.warn(`[wanna-buy] no email for user=${userId}, skipping rollover notice`);
      return;
    }

    const wannaBuyUrl = `${resolveFrontendBaseUrl(this.config)}/dashboard/wanna-buy`;
    const collectingEndsAtLabel = rollover.collectingEndsAt
      ? new Date(rollover.collectingEndsAt).toLocaleString('en-US', {
          weekday: 'long',
          month: 'short',
          day: 'numeric',
          hour: 'numeric',
          minute: '2-digit',
          timeZone: 'UTC',
        })
      : 'the next cutoff';

    const tpl = this.emailTemplates.wannaBuyBatchRolledOver({
      productTitle: item.productTitle ?? item.productUrl,
      newBatchLabel: rollover.newBatchLabel,
      collectingEndsAtLabel,
      wannaBuyUrl,
      displayName: user.firstName,
    });

    await this.notifications.sendEmail({
      to: user.email,
      subject: tpl.subject,
      text: tpl.text,
      html: tpl.html,
      idempotencyKey: `wanna-buy-rollover-${item.id}`,
    });

    this.logger.log(`[wanna-buy] rollover notice sent to ${user.email} for item=${item.id}`);
  }

  private async sendQuoteNotification(item: WannaBuyItem): Promise<void> {
    const user = item.user ?? (await this.users.findById(item.userId));
    if (!user?.email) {
      this.logger.warn(`[wanna-buy] no email for user=${item.userId}, skipping notification`);
      return;
    }

    const price = parseFloat((item.adminPriceUsd ?? item.scrapedPriceUsd) ?? '0');
    const tax = parseFloat(item.taxAmountUsd ?? '0');
    const platformFee = parseFloat(item.platformFeeUsd ?? '0');
    const kingzShipping = parseFloat(item.kingzShippingUsd ?? '0');
    const totalUsd = parseFloat(item.totalUsd ?? '0');
    const totalNgn = parseFloat(item.totalNgn ?? '0');

    const fmt = (n: number) => `$${n.toFixed(2)}`;
    const fmtNgn = (n: number) =>
      n > 0 ? `₦${n.toLocaleString('en-NG', { minimumFractionDigits: 2 })}` : '';

    const wannaBuyUrl = `${resolveFrontendBaseUrl(this.config)}/dashboard/wanna-buy`;
    const tpl = this.emailTemplates.wannaBuyQuoteReady({
      productTitle: item.productTitle ?? item.productUrl,
      priceLabel: fmt(price),
      taxLabel: fmt(tax),
      platformFeeLabel: fmt(platformFee),
      shippingLabel: fmt(kingzShipping),
      totalUsdLabel: fmt(totalUsd),
      totalNgnLabel: totalNgn > 0 ? fmtNgn(totalNgn) : null,
      wannaBuyUrl,
      displayName: user.firstName,
    });

    await this.notifications.sendEmail({
      to: user.email,
      subject: tpl.subject,
      text: tpl.text,
      html: tpl.html,
      idempotencyKey: `wanna-buy-quote-${item.id}`,
    });

    assertTransition(WANNA_BUY_ITEM_TRANSITIONS, item.status, WannaBuyItemStatus.QUOTED);
    item.notifiedAt = new Date();
    item.status = WannaBuyItemStatus.QUOTED;
    await this.items.save(item);

    this.orderRealtime.emitWannaBuyUpdate(item.userId, {
      itemId: item.id,
      status: item.status,
    });

    this.logger.log(`[wanna-buy] quote sent to ${user.email} for item=${item.id}`);
  }

  private async sendPaymentNudge(item: WannaBuyItem): Promise<void> {
    const user = item.user ?? (await this.users.findById(item.userId));
    if (!user?.email) {
      this.logger.warn(`[wanna-buy] no email for user=${item.userId}, skipping payment nudge`);
      return;
    }

    const totalUsd = parseFloat(item.totalUsd ?? '0');
    const totalLabel = `$${totalUsd.toFixed(2)}`;
    const productTitle = item.productTitle ?? item.productUrl;
    const wannaBuyUrl = `${resolveFrontendBaseUrl(this.config)}/dashboard/wanna-buy`;

    const tpl = this.emailTemplates.wannaBuyPaymentReminder({
      productTitle,
      totalLabel,
      wannaBuyUrl,
      displayName: user.firstName,
    });

    // Bucketed by minute — lets a genuinely later nudge (cron vs. an admin re-triggering)
    // through, while still protecting against an accidental rapid double-send.
    const idempotencyKey = `wanna-buy-nudge-${item.id}-${Math.floor(Date.now() / 60_000)}`;
    await this.notifications.sendEmail({
      to: user.email,
      subject: tpl.subject,
      text: tpl.text,
      html: tpl.html,
      idempotencyKey,
    });

    if (user.phone && user.phoneVerifiedAt) {
      try {
        await this.notifications.sendWhatsApp(
          user.phone,
          `Hi${user.firstName ? ` ${user.firstName}` : ''}! Your quote for ${productTitle} (${totalLabel}) is ready. Confirm & pay: ${wannaBuyUrl}`,
        );
      } catch (err) {
        this.logger.warn(
          `[wanna-buy] WhatsApp nudge failed for item=${item.id}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    item.reminderSentAt = new Date();
    await this.items.save(item);

    this.logger.log(`[wanna-buy] payment nudge sent to ${user.email} for item=${item.id}`);
  }
}
