import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { Batch } from './entities/batch.entity';
import { WannaBuyItem } from './entities/wanna-buy-item.entity';
import { BatchStatus } from '../common/enums/batch-status.enum';
import { WannaBuyItemStatus } from '../common/enums/wanna-buy-item-status.enum';
import { ScraperService } from '../scraper/scraper.service';
import { CurrencyService } from '../currency/currency.service';
import { NotificationsService } from '../notifications/notifications.service';
import { UsersService } from '../users/users.service';
import type { AddWannaBuyItemDto } from './dto/add-wanna-buy-item.dto';
import type { AdminQuoteWannaBuyItemDto } from './dto/admin-quote-wanna-buy-item.dto';
import { detectProductSource } from '../scraper/utils/detect-source.util';
import { ProductSource } from '../common/enums/product-source.enum';
import { computePlatformFee } from '../common/utils/pricing.util';
import { Order } from '../orders/entities/order.entity';
import { OrderItem } from '../orders/entities/order-item.entity';
import { OrderStatus } from '../common/enums/order-status.enum';
import type { ShippingAddress } from '../users/entities/user.entity';
import { OrderRealtimeService } from '../realtime/order-realtime.service';
import { EmailTemplateService } from '../notifications/email-templates.service';
import { ConfigService } from '@nestjs/config';
import { resolveFrontendBaseUrl } from '../common/utils/frontend-url.util';

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
    private readonly scraper: ScraperService,
    private readonly currency: CurrencyService,
    private readonly notifications: NotificationsService,
    private readonly users: UsersService,
    private readonly dataSource: DataSource,
    private readonly orderRealtime: OrderRealtimeService,
    private readonly emailTemplates: EmailTemplateService,
    private readonly config: ConfigService,
  ) {}

  // ── User endpoints ──────────────────────────────────────────────────────────

  async addItem(userId: string, dto: AddWannaBuyItemDto): Promise<WannaBuyItem> {
    const batch = await this.getOrCreateCollectingBatch();

    let scrapedPriceUsd: string | null = null;
    let productTitle: string | null = null;
    let imageUrl: string | null = null;
    let marketplace: ProductSource | null = null;

    try {
      const source = detectProductSource(dto.productUrl);
      marketplace = source;
      const scraped = await this.scraper.scrape(dto.productUrl, source);
      scrapedPriceUsd = scraped.price ? String(parseFloat(scraped.price)) : null;
      productTitle = scraped.title ?? null;
      imageUrl = scraped.images?.[0] ?? null;
    } catch (err) {
      this.logger.warn(
        `[wanna-buy] scrape failed for ${dto.productUrl}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    const item = this.items.create({
      userId,
      batchId: batch.id,
      productUrl: dto.productUrl,
      productTitle,
      imageUrl,
      marketplace,
      variantSelection: dto.variantSelection ?? null,
      scrapedPriceUsd,
      status: WannaBuyItemStatus.PENDING,
    });

    const saved = await this.items.save(item);
    this.logger.log(`[wanna-buy] item=${saved.id} added by user=${userId} batch=${batch.id}`);
    return saved;
  }

  async listUserItems(userId: string): Promise<WannaBuyItem[]> {
    return this.items.find({
      where: { userId },
      order: { createdAt: 'DESC' },
    });
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

  async advanceBatchStatus(batchId: string, status: BatchStatus): Promise<Batch> {
    const batch = await this.batches.findOne({ where: { id: batchId } });
    if (!batch) throw new NotFoundException(`Batch ${batchId} not found`);

    batch.status = status;
    const now = new Date();
    if (status === BatchStatus.PROCESSING) batch.processingStartedAt = now;
    else if (status === BatchStatus.PLACING_ORDERS) batch.placingOrdersAt = now;
    else if (status === BatchStatus.IN_TRANSIT) batch.inTransitAt = now;
    else if (status === BatchStatus.AT_WAREHOUSE) batch.atWarehouseAt = now;
    else if (status === BatchStatus.SHIPPED) batch.shippedAt = now;
    else if (status === BatchStatus.DELIVERED) batch.deliveredAt = now;

    return this.batches.save(batch);
  }

  async saveQuote(itemId: string, dto: AdminQuoteWannaBuyItemDto): Promise<WannaBuyItem> {
    const item = await this.items.findOne({
      where: { id: itemId },
      relations: ['user'],
    });
    if (!item) throw new NotFoundException(`WannaBuyItem ${itemId} not found`);

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
    }

    const saved = await this.items.save(item);

    if (dto.notifyUser) {
      await this.sendQuoteNotification(saved);
    }

    return saved;
  }

  /**
   * Creates an Order from a quoted WannaBuyItem so the user can pay through
   * the existing payment rail (Paystack / Stripe). The item must be in `quoted`
   * status and belong to the requesting user.
   *
   * Returns the newly-created Order. The caller (controller) then directs the
   * frontend to `/checkout?resume=<orderId>` so it can use the existing payment
   * provider selection + webhook flow without any changes.
   */
  async createOrderForPayment(itemId: string, userId: string): Promise<Order> {
    const item = await this.items.findOne({
      where: { id: itemId, userId },
      relations: ['user'],
    });
    if (!item) throw new NotFoundException(`WannaBuyItem ${itemId} not found`);
    if (item.status !== WannaBuyItemStatus.QUOTED) {
      throw new BadRequestException(
        `Item must be in "quoted" status before payment. Current status: ${item.status}`,
      );
    }
    if (!item.totalUsd) {
      throw new BadRequestException('Quote has not been fully computed yet — totalUsd is missing');
    }

    const user = item.user ?? (await this.users.findById(userId));
    if (!user.defaultShippingAddress) {
      throw new BadRequestException(
        'No default shipping address on file. Please add one in your profile before paying.',
      );
    }

    const effectivePriceUsd = parseFloat((item.adminPriceUsd ?? item.scrapedPriceUsd) ?? '0');
    const taxUsd = parseFloat(item.taxAmountUsd ?? '0');
    const platformFeeUsd = parseFloat(item.platformFeeUsd ?? '0');
    const kingzShippingUsd = parseFloat(item.kingzShippingUsd ?? '0');
    const fxBufferUsd = parseFloat(item.fxBufferUsd ?? '0');
    const totalUsd = parseFloat(item.totalUsd);

    const breakdown = [
      `Product: $${effectivePriceUsd.toFixed(2)}`,
      `Marketplace tax: $${taxUsd.toFixed(2)}`,
      `Platform fee: $${platformFeeUsd.toFixed(2)}`,
      `International shipping: $${kingzShippingUsd.toFixed(2)}`,
      `─────────────────────────────`,
      `Total (USD): $${totalUsd.toFixed(2)}`,
    ];

    const shippingAddress = user.defaultShippingAddress as ShippingAddress;

    const order = await this.dataSource.transaction(async (em) => {
      const o = em.create(Order, {
        userId,
        status: OrderStatus.PENDING,
        subtotal: effectivePriceUsd.toFixed(2),
        fees: platformFeeUsd.toFixed(2),
        discount: '0.00',
        shippingFee: kingzShippingUsd.toFixed(2),
        marketplaceTax: taxUsd.toFixed(2),
        marketplaceShipping: '0.00',
        domesticHandling: '0.00',
        customsTotal: '0.00',
        fxBuffer: fxBufferUsd.toFixed(2),
        riskBuffer: '0.00',
        pricingBreakdown: breakdown,
        total: totalUsd.toFixed(2),
        currency: 'USD',
        shippingAddress,
      });
      await em.save(o);

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

      return o;
    });

    // Link the order to the WannaBuyItem and mark confirmed
    item.orderId = order.id;
    item.status = WannaBuyItemStatus.CONFIRMED;
    item.confirmedAt = new Date();
    await this.items.save(item);

    this.orderRealtime.emitWannaBuyUpdate(item.userId, {
      itemId: item.id,
      status: item.status,
    });

    this.logger.log(
      `[wanna-buy] order=${order.id} created for item=${itemId} user=${userId} total=${totalUsd}`,
    );

    return order;
  }

  // ── Internal helpers ────────────────────────────────────────────────────────

  private async getOrCreateCollectingBatch(): Promise<Batch> {
    const existing = await this.batches.findOne({
      where: { status: BatchStatus.COLLECTING },
      order: { createdAt: 'DESC' },
    });
    if (existing) return existing;

    const batch = this.batches.create({ status: BatchStatus.COLLECTING });
    return this.batches.save(batch);
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

    item.notifiedAt = new Date();
    item.status = WannaBuyItemStatus.QUOTED;
    await this.items.save(item);

    this.orderRealtime.emitWannaBuyUpdate(item.userId, {
      itemId: item.id,
      status: item.status,
    });

    this.logger.log(`[wanna-buy] quote sent to ${user.email} for item=${item.id}`);
  }
}
