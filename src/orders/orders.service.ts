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
import { ScraperService } from '../scraper/scraper.service';
import { UsersService } from '../users/users.service';
import { ShippingAddress } from '../users/entities/user.entity';
import { CreateOrderDto } from './dto/create-order.dto';
import { QUEUE_SEND_NOTIFICATION } from '../jobs/queue.constants';
import type { SendNotificationJob } from '../jobs/processors/send-notification.processor';
import { OrderRealtimeService } from '../realtime/order-realtime.service';
import { computePricing } from '../common/utils/pricing.util';

@Injectable()
export class OrdersService {
  private readonly logger = new Logger(OrdersService.name);

  constructor(
    @InjectRepository(Order)
    private readonly orders: Repository<Order>,
    @InjectRepository(OrderItem)
    private readonly orderItems: Repository<OrderItem>,
    private readonly dataSource: DataSource,
    private readonly cartService: CartService,
    private readonly productsService: ProductsService,
    private readonly scraper: ScraperService,
    private readonly usersService: UsersService,
    @InjectQueue(QUEUE_SEND_NOTIFICATION)
    private readonly notifyQueue: Queue<SendNotificationJob>,
    private readonly orderRealtime: OrderRealtimeService,
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

    // Scrape all cart items in parallel — each scrape is 5-30 s, sequential adds up fast.
    const lines = await Promise.all(
      cart.items.map(async (line) => {
        const product = await this.productsService.findById(line.productId);
        this.logger.log(
          `[order] step=price_refresh productId=${line.productId} qty=${line.quantity}`,
        );
        const scraped = await this.scraper.scrape(
          product.sourceUrl,
          product.source,
        );
        const refreshed = await this.productsService.refreshPriceFromScrape(
          product,
          scraped,
        );
        const unitPrice = this.productsService.resolveVariantPrice(
          refreshed,
          line.variantSelection,
        );
        return {
          productId: refreshed.id,
          title: refreshed.title,
          price: unitPrice,
          currency: refreshed.currency,
          qty: line.quantity,
          images: refreshed.images,
          variant: line.variantSelection,
        };
      }),
    );

    // Last item's currency wins — all items in a cart are assumed to share a currency.
    const currency = lines[lines.length - 1]?.currency ?? 'USD';
    const subtotal = lines.reduce(
      (acc, l) => acc + parseFloat(l.price) * l.qty,
      0,
    );

    const pricing = computePricing(subtotal);
    const fees = pricing.fees;
    const total = pricing.total;

    this.logger.log(
      `[order] step=transaction_begin userId=${userId} subtotal=${subtotal.toFixed(2)} ` +
        `serviceCharge=${pricing.serviceCharge.toFixed(2)} discount=${pricing.discount.toFixed(2)} ` +
        `fees=${fees.toFixed(2)} total=${total.toFixed(2)} currency=${currency}`,
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
        fees: fees.toFixed(2),
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

    await this.notifyQueue.add('order_confirmation', {
      type: 'order_confirmation',
      toEmail: user.email,
      subject: `Order ${order.id} received`,
      text: `We received your order ${order.id}. Total ${currency} ${order.total}. Complete payment to proceed.`,
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

  async listForUser(
    userId: string,
    query?: { status?: string },
  ) {
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
      const o = await em.findOne(Order, {
        where: { id: orderId },
        relations: ['items'],
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
      for (const item of o.items ?? []) {
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
        this.notifyQueue
          .add('payment_confirmed', {
            type: 'payment_confirmed',
            toEmail: updated.user.email,
            subject: `Payment confirmed — order ${updated.id}`,
            text:
              `Your payment of ${updated.currency} ${updated.total} has been confirmed. ` +
              `We are now processing your order ${updated.id}.`,
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
    const subtotal = parseFloat(o.subtotal);
    const pricing = computePricing(Number.isFinite(subtotal) ? subtotal : 0);
    const pending = o.status === OrderStatus.PENDING;
    return {
      id: o.id,
      userId: o.userId,
      ...(admin && o.user ? { userEmail: o.user.email } : {}),
      status: o.status,
      subtotal: o.subtotal,
      serviceCharge: pricing.serviceCharge.toFixed(2),
      discount: pricing.discount.toFixed(2),
      fees: o.fees,
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
        nextStep: pending
          ? ('initialize_payment' as const)
          : ('none' as const),
      },
      support: {
        canRequestPriceVerification: true,
        priceVerificationEndpoint: '/reconciliation/price-disputes',
      },
    };
  }
}
