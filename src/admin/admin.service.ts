import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { Order } from '../orders/entities/order.entity';
import { OrderTracking } from '../tracking/entities/order-tracking.entity';
import { AdminPatchOrderDto } from './dto/admin-patch-order.dto';
import { OrdersService } from '../orders/orders.service';
import { ProductsService } from '../products/products.service';
import { QUEUE_SEND_NOTIFICATION } from '../jobs/queue.constants';
import type { SendNotificationJob } from '../jobs/processors/send-notification.processor';
import { OrderRealtimeService } from '../realtime/order-realtime.service';

@Injectable()
export class AdminService {
  private readonly logger = new Logger(AdminService.name);

  constructor(
    @InjectRepository(Order)
    private readonly orders: Repository<Order>,
    @InjectRepository(OrderTracking)
    private readonly tracking: Repository<OrderTracking>,
    private readonly ordersService: OrdersService,
    private readonly productsService: ProductsService,
    @InjectQueue(QUEUE_SEND_NOTIFICATION)
    private readonly notifyQueue: Queue<SendNotificationJob>,
    private readonly orderRealtime: OrderRealtimeService,
  ) {}

  async listOrders() {
    const rows = await this.orders.find({
      order: { createdAt: 'DESC' },
      relations: ['items', 'user', 'trackingEvents'],
      take: 500,
    });
    return rows.map((o) => this.ordersService.toResponse(o, true));
  }

  async listProducts() {
    const products = await this.productsService.findAllForAdmin();
    return products.map((p) => this.productsService.toResponse(p));
  }

  async patchOrder(orderId: string, dto: AdminPatchOrderDto) {
    this.logger.log(
      `[admin] step=patch_order_begin orderId=${orderId} fields=${Object.keys(dto).join(',')}`,
    );
    const order = await this.ordersService.findById(orderId);
    const previousStatus = order.status;
    // Snapshot before mutation so we can detect what actually changed.
    const previousCarrier = order.carrier;
    const previousTrackingNumber = order.trackingNumber;

    if (dto.status !== undefined) order.status = dto.status;
    if (dto.supplierOrderId !== undefined) order.supplierOrderId = dto.supplierOrderId;
    if (dto.trackingNumber !== undefined) order.trackingNumber = dto.trackingNumber;
    if (dto.carrier !== undefined) order.carrier = dto.carrier;

    await this.orders.save(order);
    this.logger.log(
      `[admin] step=patch_order_saved orderId=${orderId} status=${order.status}`,
    );

    // Only write a new tracking row when carrier + trackingNumber are supplied
    // AND at least one of them actually changed — prevents duplicate rows on
    // repeated patches with the same values.
    const trackingChanged =
      dto.carrier !== undefined &&
      dto.trackingNumber !== undefined &&
      (dto.carrier !== previousCarrier || dto.trackingNumber !== previousTrackingNumber);

    if (dto.carrier && dto.trackingNumber && trackingChanged) {
      const row = this.tracking.create({
        orderId: order.id,
        carrier: dto.carrier,
        trackingNumber: dto.trackingNumber,
        status: dto.trackingStatus ?? 'UPDATED',
        message: dto.trackingMessage ?? null,
      });
      await this.tracking.save(row);
      // Push into the already-loaded relation to avoid a second DB round-trip
      // for the response.
      order.trackingEvents = [...(order.trackingEvents ?? []), row];
      this.logger.log(
        `[admin] step=tracking_row_added orderId=${orderId} carrier=${dto.carrier}`,
      );
    }

    // Notify the customer when user-visible fields changed.
    const statusChanged = dto.status !== undefined && dto.status !== previousStatus;
    const trackingUpdated = dto.trackingNumber !== undefined;
    const userEmail = order.user?.email;
    if (userEmail && (statusChanged || trackingUpdated)) {
      const lines: string[] = [];
      if (statusChanged) lines.push(`Your order status is now: ${order.status}.`);
      if (trackingUpdated && dto.trackingNumber) {
        lines.push(`Tracking: ${dto.carrier ?? ''} ${dto.trackingNumber}`.trim());
      }
      // Fire-and-forget — notification failure must not roll back the patch.
      this.notifyQueue
        .add('shipment', {
          type: 'shipment_update',
          toEmail: userEmail,
          subject: `Order ${order.id} update`,
          text: lines.join(' '),
        })
        .then(() =>
          this.logger.log(`[admin] step=shipment_notify_queued orderId=${orderId}`),
        )
        .catch((err: unknown) =>
          this.logger.error(
            `[admin] step=shipment_notify_failed orderId=${orderId}`,
            err instanceof Error ? err.stack : String(err),
          ),
        );
    }

    // Emit realtime only when the customer-facing state actually changed.
    if (statusChanged || trackingUpdated) {
      this.orderRealtime.emitOrderUpdate(order.userId, {
        orderId: order.id,
        status: order.status,
      });
    }

    // `order` already has items, user, and trackingEvents loaded (from findById
    // + the in-memory push above) — no second DB query needed.
    return this.ordersService.toResponse(order, true);
  }
}
