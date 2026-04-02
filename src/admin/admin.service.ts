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

  listProducts() {
    return this.productsService.findAllForAdmin();
  }

  async patchOrder(orderId: string, dto: AdminPatchOrderDto) {
    this.logger.log(
      `[admin] step=patch_order_begin orderId=${orderId} fields=${Object.keys(dto).join(',')}`,
    );
    const order = await this.ordersService.findById(orderId);
    if (dto.status !== undefined) {
      order.status = dto.status;
    }
    if (dto.supplierOrderId !== undefined) {
      order.supplierOrderId = dto.supplierOrderId;
    }
    if (dto.trackingNumber !== undefined) {
      order.trackingNumber = dto.trackingNumber;
    }
    if (dto.carrier !== undefined) {
      order.carrier = dto.carrier;
    }
    await this.orders.save(order);
    this.logger.log(
      `[admin] step=patch_order_saved orderId=${orderId} status=${order.status}`,
    );

    if (dto.carrier && dto.trackingNumber) {
      const row = this.tracking.create({
        orderId: order.id,
        carrier: dto.carrier,
        trackingNumber: dto.trackingNumber,
        status: dto.trackingStatus ?? 'UPDATED',
      });
      await this.tracking.save(row);
      this.logger.log(
        `[admin] step=tracking_row_added orderId=${orderId} carrier=${dto.carrier}`,
      );
    }

    const userEmail = order.user?.email;
    if (
      userEmail &&
      (dto.status !== undefined || dto.trackingNumber !== undefined)
    ) {
      await this.notifyQueue.add('shipment', {
        type: 'shipment_update',
        toEmail: userEmail,
        subject: `Order ${order.id} update`,
        text:
          `Your order status is now ${order.status}.` +
          (dto.trackingNumber
            ? ` Tracking: ${dto.carrier ?? ''} ${dto.trackingNumber}`
            : ''),
      });
      this.logger.log(`[admin] step=shipment_notify_queued orderId=${orderId}`);
    }

    this.orderRealtime.emitOrderUpdate(order.userId, {
      orderId: order.id,
      status: order.status,
    });

    const full = await this.orders.findOne({
      where: { id: order.id },
      relations: ['items', 'trackingEvents', 'user'],
    });
    return this.ordersService.toResponse(full ?? order, true);
  }
}
