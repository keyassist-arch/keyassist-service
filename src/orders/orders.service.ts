import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { Order } from './entities/order.entity';
import { OrderItem } from './entities/order-item.entity';
import { Product } from '../products/entities/product.entity';
import { CartItem } from '../cart/entities/cart-item.entity';
import { PaymentProvider } from '../common/enums/payment-provider.enum';
import type { PaymentMethodDetails } from '../payment/types/payment-method-details.type';
import { OrderStatus } from '../common/enums/order-status.enum';
import { CartService } from '../cart/cart.service';
import { ProductsService } from '../products/products.service';
import { UsersService } from '../users/users.service';
import { ShippingAddress } from '../users/entities/user.entity';
import { CreateOrderDto } from './dto/create-order.dto';
import { QUEUE_SEND_NOTIFICATION, QUEUE_VERIFY_PRICE } from '../jobs/queue.constants';
import type { SendNotificationJob } from '../jobs/processors/send-notification.processor';
import { OrderRealtimeService } from '../realtime/order-realtime.service';
import { LandedCostService } from '../landed-cost/landed-cost.service';
import { EmailTemplateService } from '../notifications/email-templates.service';
import { WannaBuyItem } from '../wanna-buy/entities/wanna-buy-item.entity';
import { WannaBuyItemStatus } from '../common/enums/wanna-buy-item-status.enum';

@Injectable()
export class OrdersService {
  private readonly logger = new Logger(OrdersService.name);

  constructor(
    @InjectRepository(Order)
    private readonly orders: Repository<Order>,
    @InjectRepository(OrderItem)
    private readonly orderItems: Repository<OrderItem>,
    @InjectRepository(WannaBuyItem)
    private readonly wannaBuyItems: Repository<WannaBuyItem>,
    private readonly dataSource: DataSource,
    private readonly cartService: CartService,
    private readonly productsService: ProductsService,
    private readonly usersService: UsersService,
    @InjectQueue(QUEUE_SEND_NOTIFICATION)
    private readonly notifyQueue: Queue<SendNotificationJob>,
    @InjectQueue(QUEUE_VERIFY_PRICE)
    private readonly verifyPriceQueue: Queue<{ productId: string }>,
    private readonly orderRealtime: OrderRealtimeService,
    private readonly landedCostService: LandedCostService,
    private readonly emailTemplates: EmailTemplateService,
  ) {}

  async createFromCart(userId: string, dto: CreateOrderDto) {
    // Fetch cart and user in parallel — user is needed for both shipping fallback
    // and the confirmation email, so we only load it once.
    const [cart, user] = await Promise.all([
      this.cartService.assertCartHasItems(userId),
      this.usersService.findById(userId),
    ]);
    this.logger.log(
      `[order] step=start_create userId=${userId} lineCount=${cart.items.length}`,
    );

    const shipping: ShippingAddress = dto.shippingAddress
      ? (dto.shippingAddress as ShippingAddress)
      : user.defaultShippingAddress
        ? user.defaultShippingAddress
        : (() => {
            throw new BadRequestException(
              'Provide shippingAddress or set default on your profile',
            );
          })();

    // Use cached prices from the DB — avoids a 5-30 s scrape per item at checkout.
    // Background verify-price jobs are enqueued after the order is saved so prices
    // stay fresh for fulfillment without blocking the user.
    const lines = await Promise.all(
      cart.items.map(async (line) => {
        const product = await this.productsService.findById(line.productId);
        this.logger.log(
          `[order] step=price_from_cache productId=${line.productId} qty=${line.quantity} lastScrapedAt=${product.lastScrapedAt?.toISOString() ?? 'never'}`,
        );
        const unitPrice = this.productsService.resolveVariantPrice(
          product,
          line.variantSelection,
        );
        return {
          productId: product.id,
          title: product.title,
          price: unitPrice,
          currency: product.currency,
          source: product.source,
          qty: line.quantity,
          images: product.images,
          variant: line.variantSelection,
        };
      }),
    );

    const currency = 'USD';
    const subtotal = lines.reduce(
      (acc, l) => acc + parseFloat(l.price) * l.qty,
      0,
    );

    const lc = await this.landedCostService.quoteForCartLines(
      lines.map((l) => ({
        priceUsd: parseFloat(l.price),
        marketplace: l.source,
        qty: l.qty,
      })),
      {
        destination: dto.landedCost.destination,
        shippingService: dto.landedCost.shippingService,
        category: dto.landedCost.category ?? 'generic',
      },
    );

    const fees = lc.serviceChargeUsd;
    const total = lc.totalUsd;

    this.logger.log(
      `[order] step=transaction_begin userId=${userId} subtotal=${subtotal.toFixed(2)} ` +
        `serviceCharge=${lc.serviceChargeUsd.toFixed(2)} discount=${lc.discountUsd.toFixed(2)} ` +
        `shipping=${lc.internationalShippingUsd.toFixed(2)} ` +
        `total=${total.toFixed(2)} currency=${currency}`,
    );

    const order = await this.dataSource.transaction(async (em) => {
      for (const l of lines) {
        const p = await em.findOne(Product, {
          where: { id: l.productId },
          lock: { mode: 'pessimistic_write' },
        });
        if (!p) {
          throw new NotFoundException(`Product ${l.productId} not found`);
        }
        if (p.stockQuantity != null && p.stockQuantity < l.qty) {
          throw new BadRequestException(
            `Insufficient stock for "${p.title}" (available: ${p.stockQuantity}, requested: ${l.qty})`,
          );
        }
      }

      const o = em.create(Order, {
        userId,
        status: OrderStatus.PENDING,
        subtotal: subtotal.toFixed(2),
        fees: lc.serviceChargeUsd.toFixed(2),
        discount: lc.discountUsd.toFixed(2),
        shippingFee: lc.internationalShippingUsd.toFixed(2),
        marketplaceTax: lc.marketplaceTaxUsd.toFixed(2),
        marketplaceShipping: lc.marketplaceShippingUsd.toFixed(2),
        domesticHandling: lc.domesticHandlingUsd.toFixed(2),
        customsTotal: '0.00',
        fxBuffer: lc.fxBufferUsd.toFixed(2),
        riskBuffer: lc.riskBufferUsd.toFixed(2),
        pricingBreakdown: lc.breakdown,
        total: total.toFixed(2),
        currency,
        shippingAddress: shipping,
      });
      await em.save(o);
      const savedItems: OrderItem[] = [];
      for (const l of lines) {
        savedItems.push(
          await em.save(
            em.create(OrderItem, {
              orderId: o.id,
              productId: l.productId,
              titleSnapshot: l.title,
              priceSnapshot: l.price,
              currencySnapshot: l.currency,
              quantity: l.qty,
              imagesSnapshot: l.images,
              variantSnapshot: l.variant,
            }),
          ),
        );
      }
      await em.delete(CartItem, { cartId: cart.id });
      // Attach items in-memory — avoids a second DB round-trip inside the transaction.
      o.items = savedItems;
      return o;
    });

    if (!order) {
      throw new BadRequestException('Order creation failed');
    }

    this.logger.log(
      `[order] step=created orderId=${order.id} userId=${userId} total=${order.total} ${order.currency}`,
    );

    // Enqueue a background price-verify job for each purchased product so the catalog
    // stays fresh for fulfillment. Fire-and-forget — never block the checkout response.
    const seenProducts = new Set<string>();
    for (const l of lines) {
      if (seenProducts.has(l.productId)) continue;
      seenProducts.add(l.productId);
      this.verifyPriceQueue
        .add('verify', { productId: l.productId }, {
          jobId: `post-checkout-${l.productId}`,
          delay: 0,
        })
        .catch((err: unknown) =>
          this.logger.warn(
            `[order] step=verify_price_enqueue_failed orderId=${order.id} productId=${l.productId}: ${err instanceof Error ? err.message : String(err)}`,
          ),
        );
    }

    const confirmTpl = this.emailTemplates.orderConfirmation({
      orderId: order.id,
      currency,
      total: order.total,
      displayName: [user.firstName, user.lastName].filter(Boolean).join(' ') || null,
    });
    await this.notifyQueue.add('order_confirmation', {
      type: 'order_confirmation',
      toEmail: user.email,
      ...confirmTpl,
    });
    this.logger.log(
      `[order] step=confirmation_email_queued orderId=${order.id}`,
    );

    this.orderRealtime.emitOrderUpdate(userId, {
      orderId: order.id,
      status: order.status,
    });
    this.logger.log(
      `[order] step=realtime_emitted orderId=${order.id} status=${order.status}`,
    );

    return this.toResponse(order);
  }

  async listForUser(userId: string, query?: { status?: string }) {
    const status = query?.status?.trim();
    if (status) {
      const values = new Set<string>(Object.values(OrderStatus) as string[]);
      if (!values.has(status)) {
        throw new BadRequestException(
          `Invalid status. Use one of: ${[...values].join(', ')}`,
        );
      }
    }
    const list = await this.orders.find({
      where: {
        userId,
        ...(status ? { status: status as OrderStatus } : {}),
      },
      order: { createdAt: 'DESC' },
      relations: ['items'],
    });
    return list.map((o) => this.toResponse(o));
  }

  /**
   * Most recent unpaid order, for a global “Complete payment” banner / deep link
   * when the cart is already empty.
   */
  async getMostRecentPayableOrder(userId: string) {
    const o = await this.orders.findOne({
      where: { userId, status: OrderStatus.PENDING },
      order: { createdAt: 'DESC' },
      relations: ['items', 'trackingEvents'],
    });
    if (!o) {
      return { order: null };
    }
    return { order: this.toResponse(o) };
  }

  async findForUser(userId: string, orderId: string) {
    const o = await this.orders.findOne({
      where: { id: orderId, userId },
      relations: ['items', 'trackingEvents'],
    });
    if (!o) {
      throw new NotFoundException('Order not found');
    }
    return this.toResponse(o);
  }

  /**
   * Self-serve cancel — only while the order hasn't been paid yet, so no
   * money has moved and there's nothing to refund. Once PAID or later,
   * customers go through the existing disputes/support flow instead.
   */
  async cancelOrder(userId: string, orderId: string) {
    const o = await this.orders.findOne({
      where: { id: orderId, userId },
      relations: ['items', 'trackingEvents'],
    });
    if (!o) {
      throw new NotFoundException('Order not found');
    }
    if (o.status !== OrderStatus.PENDING) {
      throw new BadRequestException(
        `Only unpaid orders can be cancelled (current status: ${o.status})`,
      );
    }
    o.status = OrderStatus.CANCELLED;
    await this.orders.save(o);
    this.logger.log(`[order] step=cancelled_by_user orderId=${o.id} userId=${userId}`);
    this.orderRealtime.emitOrderUpdate(userId, {
      orderId: o.id,
      status: o.status,
    });
    return this.toResponse(o);
  }

  async findById(orderId: string): Promise<Order> {
    const o = await this.orders.findOne({
      where: { id: orderId },
      relations: ['items', 'user', 'trackingEvents'],
    });
    if (!o) {
      throw new NotFoundException('Order not found');
    }
    return o;
  }

  async findByCheckoutId(checkoutId: string): Promise<Order | null> {
    return this.orders
      .createQueryBuilder('o')
      .where(`o.payment_method_details @> :val::jsonb`, {
        val: JSON.stringify({ checkoutId }),
      })
      .getOne();
  }

  async setStripeCheckoutSession(
    orderId: string,
    userId: string,
    sessionId: string,
  ): Promise<Order> {
    const o = await this.findById(orderId);
    if (o.userId !== userId) {
      throw new BadRequestException('Order not found');
    }
    if (o.status !== OrderStatus.PENDING) {
      throw new BadRequestException('Order is not payable in current state');
    }
    o.stripeCheckoutSessionId = sessionId;
    return this.orders.save(o);
  }

  async setPendingCheckoutReference(
    orderId: string,
    userId: string,
    input: {
      provider: PaymentProvider;
      checkoutId: string;
      paystackReference?: string | null;
      stripeCheckoutSessionId?: string | null;
      details?: Record<string, unknown>;
    },
  ): Promise<Order> {
    const o = await this.findById(orderId);
    if (o.userId !== userId) {
      throw new BadRequestException('Order not found');
    }
    if (o.status !== OrderStatus.PENDING) {
      throw new BadRequestException('Order is not payable in current state');
    }
    o.paymentProvider = input.provider;
    if (input.paystackReference != null) {
      o.paystackReference = input.paystackReference;
    }
    if (input.stripeCheckoutSessionId != null) {
      o.stripeCheckoutSessionId = input.stripeCheckoutSessionId;
    }
    o.paymentMethodDetails = {
      ...(o.paymentMethodDetails ?? {}),
      ...(input.details ?? {}),
      checkoutId: input.checkoutId,
      checkoutProvider: input.provider,
    } as Record<string, unknown>;
    return this.orders.save(o);
  }

  async markOrderPaid(
    orderId: string,
    input: {
      provider: PaymentProvider;
      paystackReference?: string | null;
      stripeCheckoutSessionId?: string | null;
      stripePaymentIntentId?: string | null;
      paymentMethodDetails?: PaymentMethodDetails | null;
    },
  ): Promise<Order | null> {
    this.logger.log(
      `[order] step=mark_paid_begin orderId=${orderId} provider=${input.provider}`,
    );
    const updated = await this.dataSource.transaction(async (em) => {
      // Lock only the Order row here — `FOR UPDATE` combined with the `items`
      // relation's LEFT JOIN is rejected by Postgres ("cannot be applied to
      // the nullable side of an outer join"). Items are loaded separately below.
      const o = await em.findOne(Order, {
        where: { id: orderId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!o || o.status !== OrderStatus.PENDING) {
        if (!o) {
          this.logger.warn(
            `[order] step=mark_paid_skip reason=not_found orderId=${orderId}`,
          );
        } else {
          this.logger.log(
            `[order] step=mark_paid_skip reason=not_pending orderId=${orderId} status=${o.status}`,
          );
        }
        return o ?? null;
      }
      const items = await em.find(OrderItem, { where: { orderId: o.id } });

      o.status = OrderStatus.PAID;
      o.paymentProvider = input.provider;
      if (input.paystackReference != null) {
        o.paystackReference = input.paystackReference;
      }
      if (input.stripeCheckoutSessionId != null) {
        o.stripeCheckoutSessionId = input.stripeCheckoutSessionId;
      }
      if (input.stripePaymentIntentId != null) {
        o.stripePaymentIntentId = input.stripePaymentIntentId;
      }
      o.paymentMethodDetails = input.paymentMethodDetails
        ? ({ ...input.paymentMethodDetails } as Record<string, unknown>)
        : null;
      await em.save(o);

      const prodRepo = em.getRepository(Product);
      for (const item of items) {
        if (!item.productId) {
          continue;
        }
        const p = await prodRepo.findOne({
          where: { id: item.productId },
          lock: { mode: 'pessimistic_write' },
        });
        if (p && p.stockQuantity != null) {
          p.stockQuantity -= item.quantity;
          await prodRepo.save(p);
        }
      }

      return em.findOne(Order, {
        where: { id: o.id },
        relations: ['items', 'user'],
      });
    });

    // Sync any linked WannaBuyItem(s) to paid status — bulk-pay puts several
    // items on one Order, so this must update every match, not just one.
    // setImmediate defers to the next event-loop tick so this query runs on a
    // fresh pool connection rather than on the client still finishing the
    // transaction above — avoids the pg "client already executing" warning.
    if (updated?.status === OrderStatus.PAID) {
      setImmediate((): void => {
        void (async () => {
          try {
            const items = await this.wannaBuyItems.find({ where: { orderId } });
            const now = new Date();
            for (const wbi of items) {
              // Webhook retries are common — skip items already synced past PAID.
              if (wbi.status === WannaBuyItemStatus.PAID || wbi.status === WannaBuyItemStatus.ORDERED) {
                continue;
              }
              wbi.status = WannaBuyItemStatus.PAID;
              wbi.paidAt = now;
              await this.wannaBuyItems.save(wbi);
              this.orderRealtime.emitWannaBuyUpdate(wbi.userId, {
                itemId: wbi.id,
                status: wbi.status,
              });
              this.logger.log(`[order] step=wanna_buy_marked_paid itemId=${wbi.id} orderId=${orderId}`);
            }
          } catch (err) {
            this.logger.error(
              `[order] step=wanna_buy_sync_failed orderId=${orderId}`,
              err instanceof Error ? err.stack : String(err),
            );
          }
        })();
      });
    }

    if (updated?.status === OrderStatus.PAID) {
      this.logger.log(
        `[order] step=mark_paid_done orderId=${orderId} userId=${updated.userId}`,
      );
      this.orderRealtime.emitOrderUpdate(updated.userId, {
        orderId: updated.id,
        status: updated.status,
      });
      this.logger.log(`[order] step=paid_realtime_emitted orderId=${orderId}`);

      if (updated.user?.email) {
        const paidTpl = this.emailTemplates.paymentConfirmed({
          orderId: updated.id,
          currency: updated.currency,
          total: updated.total,
          displayName:
            [updated.user.firstName, updated.user.lastName].filter(Boolean).join(' ') || null,
        });
        this.notifyQueue
          .add('payment_confirmed', {
            type: 'payment_confirmed',
            toEmail: updated.user.email,
            ...paidTpl,
          })
          .catch((err: unknown) =>
            this.logger.error(
              `[order] step=paid_notify_failed orderId=${orderId}`,
              err instanceof Error ? err.stack : String(err),
            ),
          );
      }
    }
    return updated;
  }

  toResponse(o: Order, admin = false) {
    const pending = o.status === OrderStatus.PENDING;

    // Collapsed 3-line summary for the checkout/order screen.
    // "Import & Delivery" bundles all logistics + customs so the user
    // sees a simple, trustworthy breakdown instead of 6+ individual fees.
    const importAndDelivery = (
      parseFloat(o.marketplaceTax    || '0') +
      parseFloat(o.marketplaceShipping || '0') +
      parseFloat(o.domesticHandling  || '0') +
      parseFloat(o.shippingFee       || '0') +
      parseFloat(o.customsTotal      || '0') +
      parseFloat(o.fxBuffer          || '0') +
      parseFloat(o.riskBuffer        || '0')
    ).toFixed(2);

    return {
      id: o.id,
      userId: o.userId,
      ...(admin && o.user ? { userEmail: o.user.email } : {}),
      status: o.status,
      // ── 3-line UI summary ──────────────────────────────────────────────────
      displaySummary: {
        product: o.subtotal,
        importAndDelivery,
        serviceFee: o.fees,
        discount: o.discount,
        total: o.total,
        currency: o.currency,
      },
      // ── Granular fields (use for "View breakdown" drawer / admin) ──────────
      subtotal: o.subtotal,
      serviceCharge: o.fees,
      discount: o.discount,
      fees: o.fees,
      shippingFee: o.shippingFee,
      marketplaceTax: o.marketplaceTax,
      marketplaceShipping: o.marketplaceShipping,
      domesticHandling: o.domesticHandling,
      customsTotal: o.customsTotal,
      fxBuffer: o.fxBuffer,
      riskBuffer: o.riskBuffer,
      pricingBreakdown: o.pricingBreakdown ?? [],
      total: o.total,
      currency: o.currency,
      shippingAddress: o.shippingAddress,
      payment: {
        provider: o.paymentProvider,
        methodDetails: o.paymentMethodDetails,
        paystackReference: o.paystackReference,
        stripeCheckoutSessionId: o.stripeCheckoutSessionId,
        stripePaymentIntentId: o.stripePaymentIntentId,
      },
      supplierOrderId: o.supplierOrderId,
      trackingNumber: o.trackingNumber,
      carrier: o.carrier,
      items: (o.items || []).map((i) => ({
        id: i.id,
        productId: i.productId,
        title: i.titleSnapshot,
        price: i.priceSnapshot,
        currency: i.currencySnapshot,
        quantity: i.quantity,
        images: i.imagesSnapshot,
        variant: i.variantSnapshot,
      })),
      tracking: (o.trackingEvents || []).map((t) => ({
        id: t.id,
        carrier: t.carrier,
        trackingNumber: t.trackingNumber,
        status: t.status,
        message: t.message ?? null,
        createdAt: t.createdAt,
      })),
      createdAt: o.createdAt,
      updatedAt: o.updatedAt,
      checkout: {
        canInitializePayment: pending,
        /** `initialize_payment` when unpaid — use `id` on `POST /payments/initialize` (cart is often already empty). */
        nextStep: pending ? ('initialize_payment' as const) : ('none' as const),
      },
      support: {
        canRequestPriceVerification: true,
        priceVerificationEndpoint: '/reconciliation/price-disputes',
      },
    };
  }
}
