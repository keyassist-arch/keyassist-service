import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as bcrypt from 'bcrypt';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { Order } from '../orders/entities/order.entity';
import { OrderTracking } from '../tracking/entities/order-tracking.entity';
import { User } from '../users/entities/user.entity';
import { UserRole } from '../common/enums/role.enum';
import { AdminPatchOrderDto } from './dto/admin-patch-order.dto';
import { OrdersService } from '../orders/orders.service';
import { ProductsService } from '../products/products.service';
import { QUEUE_SEND_NOTIFICATION } from '../jobs/queue.constants';
import type { SendNotificationJob } from '../jobs/processors/send-notification.processor';
import { OrderRealtimeService } from '../realtime/order-realtime.service';
import { ShippingRatesService } from '../shipping/shipping-rates.service';
import { UpdateShippingRatesDto } from '../shipping/dto/update-shipping-rates.dto';
import { EmailTemplateService } from '../notifications/email-templates.service';
import { UploadsService } from '../uploads/uploads.service';
import { AdminCreateProductDto } from '../products/dto/admin-create-product.dto';
import { AdminUpdateProductDto } from '../products/dto/admin-update-product.dto';

@Injectable()
export class AdminService {
  private readonly logger = new Logger(AdminService.name);

  constructor(
    @InjectRepository(Order)
    private readonly orders: Repository<Order>,
    @InjectRepository(OrderTracking)
    private readonly tracking: Repository<OrderTracking>,
    @InjectRepository(User)
    private readonly users: Repository<User>,
    private readonly config: ConfigService,
    private readonly ordersService: OrdersService,
    private readonly productsService: ProductsService,
    @InjectQueue(QUEUE_SEND_NOTIFICATION)
    private readonly notifyQueue: Queue<SendNotificationJob>,
    private readonly orderRealtime: OrderRealtimeService,
    private readonly shippingRatesService: ShippingRatesService,
    private readonly emailTemplates: EmailTemplateService,
    private readonly uploadsService: UploadsService,
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

  async deleteProduct(id: string): Promise<void> {
    await this.productsService.remove(id);
  }

  async createProduct(dto: AdminCreateProductDto) {
    const product = await this.productsService.createManual(dto);
    return this.productsService.toResponse(product);
  }

  async updateProduct(id: string, dto: AdminUpdateProductDto) {
    const product = await this.productsService.updateManual(id, dto);
    return this.productsService.toResponse(product);
  }

  getProductImageUploadSignature() {
    return this.uploadsService.generateProductImageSignature();
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
    if (dto.supplierOrderId !== undefined)
      order.supplierOrderId = dto.supplierOrderId;
    if (dto.trackingNumber !== undefined)
      order.trackingNumber = dto.trackingNumber;
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
      (dto.carrier !== previousCarrier ||
        dto.trackingNumber !== previousTrackingNumber);

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
    const statusChanged =
      dto.status !== undefined && dto.status !== previousStatus;
    const trackingUpdated = dto.trackingNumber !== undefined;
    const userEmail = order.user?.email;
    if (userEmail && (statusChanged || trackingUpdated)) {
      const lines: string[] = [];
      if (statusChanged)
        lines.push(`Your order status is now: ${order.status}.`);
      if (trackingUpdated && dto.trackingNumber) {
        lines.push(
          `Tracking: ${dto.carrier ?? ''} ${dto.trackingNumber}`.trim(),
        );
      }
      // Fire-and-forget — notification failure must not roll back the patch.
      const shipTpl = this.emailTemplates.shipmentUpdate({
        orderId: order.id,
        status: dto.status ?? null,
        trackingNumber: dto.trackingNumber ?? null,
        carrier: dto.carrier ?? null,
        displayName:
          [order.user?.firstName, order.user?.lastName].filter(Boolean).join(' ') || null,
      });
      this.notifyQueue
        .add('shipment', {
          type: 'shipment_update',
          toEmail: userEmail,
          ...shipTpl,
        })
        .then(() =>
          this.logger.log(
            `[admin] step=shipment_notify_queued orderId=${orderId}`,
          ),
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

  async getShippingRates() {
    return this.shippingRatesService.getRow();
  }

  async updateShippingRates(dto: UpdateShippingRatesDto) {
    return this.shippingRatesService.update(dto);
  }

  async seed(setupKey: string) {
    const expected = this.config.get<string>('SETUP_KEY');
    if (!expected || setupKey !== expected) {
      throw new UnauthorizedException('Invalid setup key');
    }

    const email = 'admin@example.com';
    let admin = await this.users.findOne({ where: { email } });
    if (admin) {
      return { message: 'Admin user already exists', email };
    }

    admin = this.users.create({
      firstName: 'Admin',
      lastName: 'User',
      email,
      passwordHash: await bcrypt.hash('Admin123!seed', 10),
      role: UserRole.ADMIN_SUPER,
      phone: '+10000000001',
      emailVerifiedAt: new Date(),
    });
    await this.users.save(admin);
    this.logger.log(`Created admin user: ${email}`);
    return { message: 'Admin user created', email, password: 'Admin123!seed' };
  }
}
