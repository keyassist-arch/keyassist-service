import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Not, Repository } from 'typeorm';
import { ImportedProduct } from '../products/entities/imported-product.entity';
import { OrdersService } from '../orders/orders.service';
import { ShippingAddress } from '../users/entities/user.entity';
import { AdminPlaceManualImportOrderDto } from './dto/admin-place-manual-import-order.dto';
import { AdminDismissManualImportDto } from './dto/admin-dismiss-manual-import.dto';

export type ManualImportFulfillmentStatus = 'pending' | 'ordered' | 'dismissed';

@Injectable()
export class AdminManualImportsService {
  private readonly logger = new Logger(AdminManualImportsService.name);

  constructor(
    @InjectRepository(ImportedProduct)
    private readonly imports: Repository<ImportedProduct>,
    private readonly ordersService: OrdersService,
  ) {}

  async list(status: ManualImportFulfillmentStatus) {
    const where =
      status === 'pending'
        ? { requestedByUserId: Not(IsNull()), orderId: IsNull(), dismissedAt: IsNull() }
        : status === 'ordered'
          ? { orderId: Not(IsNull()) }
          : { dismissedAt: Not(IsNull()), orderId: IsNull() };

    const rows = await this.imports.find({
      where,
      relations: ['product', 'requestedByUser'],
      order: { createdAt: 'DESC' },
      take: 500,
    });
    return rows.map((r) => this.toResponse(r));
  }

  async placeOrder(importId: string, dto: AdminPlaceManualImportOrderDto) {
    const row = await this.imports.findOne({
      where: { id: importId },
      relations: ['product'],
    });
    if (!row) throw new NotFoundException('Manual import request not found');
    if (!row.requestedByUserId) {
      throw new BadRequestException('This import has no attributed requester');
    }
    if (row.orderId) {
      throw new ConflictException('An order has already been placed for this request');
    }
    if (!row.product) {
      throw new BadRequestException('No product is linked to this import');
    }

    const order = await this.ordersService.createForUserFromItems(
      row.requestedByUserId,
      [{ productId: row.product.id, quantity: 1 }],
      dto.landedCost,
      dto.shippingAddress as ShippingAddress | undefined,
    );

    row.orderId = order.id;
    await this.imports.save(row);
    this.logger.log(
      `[admin_manual_import] step=order_placed importId=${importId} orderId=${order.id}`,
    );
    return order;
  }

  async dismiss(importId: string, dto: AdminDismissManualImportDto) {
    const row = await this.imports.findOne({ where: { id: importId } });
    if (!row) throw new NotFoundException('Manual import request not found');
    if (row.orderId) {
      throw new ConflictException('Cannot dismiss a request that already has an order');
    }
    row.dismissedAt = new Date();
    row.dismissReason = dto.reason ?? null;
    await this.imports.save(row);
    this.logger.log(`[admin_manual_import] step=dismissed importId=${importId}`);
    return { ok: true };
  }

  private toResponse(r: ImportedProduct) {
    const fulfillmentStatus: ManualImportFulfillmentStatus = r.orderId
      ? 'ordered'
      : r.dismissedAt
        ? 'dismissed'
        : 'pending';

    return {
      id: r.id,
      sourceUrl: r.sourceUrl,
      fulfillmentStatus,
      createdAt: r.createdAt,
      product: r.product
        ? {
            id: r.product.id,
            slug: r.product.slug ?? null,
            title: r.product.title,
            images: r.product.images ?? [],
            salePrice: r.product.salePrice,
            currency: r.product.currency,
          }
        : null,
      requestedByUser: r.requestedByUser
        ? {
            id: r.requestedByUser.id,
            email: r.requestedByUser.email,
            firstName: r.requestedByUser.firstName,
            lastName: r.requestedByUser.lastName,
          }
        : null,
      orderId: r.orderId,
      dismissedAt: r.dismissedAt,
      dismissReason: r.dismissReason,
    };
  }
}
