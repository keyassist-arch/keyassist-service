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

  private async resolveShipping(
    userId: string,
    dto?: CreateOrderDto,
  ): Promise<ShippingAddress> {
    if (dto?.shippingAddress) {
      return dto.shippingAddress as ShippingAddress;
    }
    const user = await this.usersService.findById(userId);
    if (!user.defaultShippingAddress) {
      throw new BadRequestException(
        'Provide shippingAddress or set default on your profile',
      );
    }
    return user.defaultShippingAddress;
  }

  async createFromCart(userId: string, dto: CreateOrderDto) {
    const cart = await this.cartService.assertCartHasItems(userId);
    this.logger.log(
      `[order] step=start_create userId=${userId} lineCount=${cart.items.length}`,
    );
    const shipping = await this.resolveShipping(userId, dto);

    const lines: {
      productId: string;
      title: string;
      price: string;
      currency: string;
      qty: number;
      images: string[];
      variant: Record<string, string> | null;
    }[] = [];

    let currency = 'USD';
    let subtotal = 0;

    for (const line of cart.items) {
      const product = await this.productsService.findById(line.productId);
      this.logger.log(
        `[order] step=price_refresh productId=${line.productId} qty=${line.quantity}`,
      );
      currency = product.currency;
      const scraped = await this.scraper.scrape(
        product.sourceUrl,
        product.source,
      );
      const refreshed = await this.productsService.refreshPriceFromScrape(
        product,
        scraped,
      );
      const unit = parseFloat(refreshed.salePrice);
      subtotal += unit * line.quantity;
      lines.push({
        productId: refreshed.id,
        title: refreshed.title,
        price: refreshed.salePrice,
        currency: refreshed.currency,
        qty: line.quantity,
        images: refreshed.images,
        variant: line.variantSelection,
      });
    }

    const fees = 0;
    const total = subtotal + fees;

    this.logger.log(
      `[order] step=transaction_begin userId=${userId} subtotal=${subtotal.toFixed(2)} currency=${currency}`,
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
      for (const l of lines) {
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
        );
      }
      await em.delete(CartItem, { cartId: cart.id });
      return em.findOne(Order, {
        where: { id: o.id },
        relations: ['items'],
      });
    });

    if (!order) {
      throw new BadRequestException('Order creation failed');
    }

    this.logger.log(
      `[order] step=created orderId=${order.id} userId=${userId} total=${order.total} ${order.currency}`,
    );

    const user = await this.usersService.findById(userId);
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

  async listForUser(userId: string) {
    const list = await this.orders.find({
      where: { userId },
      order: { createdAt: 'DESC' },
      relations: ['items'],
    });
    return list.map((o) => this.toResponse(o));
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
        relations: ['items'],
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
    }
    return updated;
  }

  toResponse(o: Order, admin = false) {
    return {
      id: o.id,
      userId: o.userId,
      ...(admin && o.user ? { userEmail: o.user.email } : {}),
      status: o.status,
      subtotal: o.subtotal,
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
        updatedAt: t.updatedAt,
      })),
      createdAt: o.createdAt,
      updatedAt: o.updatedAt,
    };
  }
}
