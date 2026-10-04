import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';
import { IsNull, Not, Repository } from 'typeorm';
import { ImportedProduct } from '../products/entities/imported-product.entity';
import { Product } from '../products/entities/product.entity';
import { OrdersService } from '../orders/orders.service';
import { CartService } from '../cart/cart.service';
import { NotificationsService } from '../notifications/notifications.service';
import { EmailTemplateService } from '../notifications/email-templates.service';
import { resolveFrontendBaseUrl } from '../common/utils/frontend-url.util';
import { ShippingAddress } from '../users/entities/user.entity';
import { AdminPlaceManualImportOrderDto } from './dto/admin-place-manual-import-order.dto';
import { AdminDismissManualImportDto } from './dto/admin-dismiss-manual-import.dto';
import { AdminApproveManualImportToCartDto } from './dto/admin-approve-manual-import-to-cart.dto';

export type ManualImportFulfillmentStatus = 'pending' | 'ordered' | 'dismissed';

@Injectable()
export class AdminManualImportsService {
  private readonly logger = new Logger(AdminManualImportsService.name);

  constructor(
    @InjectRepository(ImportedProduct)
    private readonly imports: Repository<ImportedProduct>,
    @InjectRepository(Product)
    private readonly productsRepo: Repository<Product>,
    private readonly ordersService: OrdersService,
    private readonly cartService: CartService,
    private readonly notifications: NotificationsService,
    private readonly emailTemplates: EmailTemplateService,
    private readonly config: ConfigService,
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

  /**
   * Approves a customer-submitted manual import by pricing the product,
   * adding it directly to the customer's active cart, and sending a notification email.
   */
  async approveToCart(importId: string, dto: AdminApproveManualImportToCartDto) {
    const row = await this.imports.findOne({
      where: { id: importId },
      relations: ['product', 'requestedByUser'],
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

    const priceFormatted = `${dto.currency || row.product.currency || 'USD'} ${dto.price.toFixed(2)}`;

    // 1. Update product with verified supplier price and title
    const product = row.product;
    product.originalPrice = dto.price.toFixed(2);
    product.salePrice = dto.price.toFixed(2);
    if (dto.currency) {
      product.currency = dto.currency.toUpperCase();
    }
    if (dto.title?.trim()) {
      product.title = dto.title.trim();
    }
    product.rescrapeEnabled = false;
    await this.productsRepo.save(product);

    // 2. Add the product directly to the customer's cart
    await this.cartService.addItem(row.requestedByUserId, product.id, 1);

    // 3. Mark the manual import as fulfilled/approved
    row.dismissedAt = new Date();
    row.dismissReason = 'Approved and added to customer cart';
    await this.imports.save(row);

    // 4. Send email notification to the customer
    if (row.requestedByUser?.email) {
      const frontendUrl = resolveFrontendBaseUrl(this.config);
      const cartUrl = `${frontendUrl}/cart`;
      const tpl = this.emailTemplates.manualImportApprovedToCart({
        productTitle: product.title,
        priceFormatted,
        cartUrl,
        displayName: row.requestedByUser.firstName || row.requestedByUser.email,
        sourceUrl: row.sourceUrl,
      });

      try {
        await this.notifications.sendEmail({
          to: row.requestedByUser.email,
          subject: tpl.subject,
          text: tpl.text,
          html: tpl.html,
        });
      } catch (err) {
        this.logger.error(
          `[admin_manual_import] step=approve_email_failed importId=${importId}`,
          err instanceof Error ? err.stack : err,
        );
      }
    }

    this.logger.log(
      `[admin_manual_import] step=approved_to_cart importId=${importId} userId=${row.requestedByUserId} price=${dto.price}`,
    );

    return {
      ok: true,
      message: 'Product verified, priced, and added to customer cart. Notification email sent.',
      productId: product.id,
    };
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
            description: r.product.description ?? null,
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
