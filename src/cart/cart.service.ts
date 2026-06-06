import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Cart } from './entities/cart.entity';
import { CartItem } from './entities/cart-item.entity';
import { ProductsService } from '../products/products.service';
import { computePricing } from '../common/utils/pricing.util';

/** Hard ceiling on any single line-item quantity. */
const MAX_ITEM_QUANTITY = 100;

@Injectable()
export class CartService {
  constructor(
    @InjectRepository(Cart)
    private readonly carts: Repository<Cart>,
    @InjectRepository(CartItem)
    private readonly items: Repository<CartItem>,
    private readonly productsService: ProductsService,
  ) {}

  async getOrCreateCart(userId: string): Promise<Cart> {
    const existing = await this.carts.findOne({
      where: { userId },
      relations: ['items', 'items.product'],
    });
    if (existing) return existing;

    // New cart — no items yet, skip a second DB round-trip.
    const created = await this.carts.save(this.carts.create({ userId }));
    created.items = [];
    return created;
  }

  async getCart(userId: string) {
    const cart = await this.getOrCreateCart(userId);
    return this.toResponse(cart);
  }

  async addItem(
    userId: string,
    productId: string,
    quantity: number,
    variantSelection?: Record<string, string>,
  ) {
    const cart = await this.getOrCreateCart(userId);
    await this.applyLineToCart(cart.id, productId, quantity, variantSelection);
    return this.getCart(userId);
  }

  /**
   * Merges guest/local cart lines into the user's server cart.
   *
   * Optimised path vs. the naive sequential loop:
   *  - Products are validated in parallel (one concurrent round of DB calls).
   *  - All existing items for this cart are fetched in a single query.
   *  - Upserts are batched into one `save` call.
   */
  async mergeLocalCart(
    userId: string,
    items: Array<{
      productId: string;
      quantity: number;
      variantSelection?: Record<string, string>;
    }>,
  ) {
    if (!items.length) return this.getCart(userId);

    const cart = await this.getOrCreateCart(userId);

    // Deduplicate incoming lines by productId (quantities sum, last variantSelection wins).
    const linesByProduct = new Map<
      string,
      { quantity: number; variantSelection?: Record<string, string> }
    >();
    for (const line of items) {
      const prev = linesByProduct.get(line.productId);
      linesByProduct.set(line.productId, {
        quantity: (prev?.quantity ?? 0) + line.quantity,
        variantSelection: line.variantSelection ?? prev?.variantSelection,
      });
    }

    // Validate all products in parallel — throws NotFoundException for any unknown id.
    await Promise.all(
      [...linesByProduct.keys()].map((id) => this.productsService.findById(id)),
    );

    // Fetch existing items for this cart in one query.
    const existingItems = await this.items.find({ where: { cartId: cart.id } });
    const existingByProduct = new Map(
      existingItems.map((i) => [i.productId, i]),
    );

    // Build upserts in memory, then flush in a single batch.
    const toSave: CartItem[] = [];
    for (const [productId, { quantity, variantSelection }] of linesByProduct) {
      const existing = existingByProduct.get(productId);
      if (existing) {
        existing.quantity = Math.min(
          existing.quantity + quantity,
          MAX_ITEM_QUANTITY,
        );
        if (variantSelection !== undefined) {
          existing.variantSelection = variantSelection;
        }
        toSave.push(existing);
      } else {
        toSave.push(
          this.items.create({
            cartId: cart.id,
            productId,
            quantity: Math.min(quantity, MAX_ITEM_QUANTITY),
            variantSelection: variantSelection ?? null,
          }),
        );
      }
    }

    if (toSave.length) await this.items.save(toSave);

    return this.getCart(userId);
  }

  private async applyLineToCart(
    cartId: string,
    productId: string,
    quantity: number,
    variantSelection?: Record<string, string>,
  ): Promise<void> {
    await this.productsService.findById(productId);
    const item = await this.items.findOne({ where: { cartId, productId } });
    if (item) {
      item.quantity = Math.min(item.quantity + quantity, MAX_ITEM_QUANTITY);
      if (variantSelection) item.variantSelection = variantSelection;
      await this.items.save(item);
    } else {
      await this.items.save(
        this.items.create({
          cartId,
          productId,
          quantity: Math.min(quantity, MAX_ITEM_QUANTITY),
          variantSelection: variantSelection ?? null,
        }),
      );
    }
  }

  async removeItem(userId: string, itemId: string) {
    // Load the cart relation to verify ownership without creating a new cart.
    const item = await this.items.findOne({
      where: { id: itemId },
      relations: ['cart'],
    });
    if (!item || item.cart.userId !== userId) {
      throw new NotFoundException('Cart item not found');
    }
    await this.items.remove(item);
    return this.getCart(userId);
  }

  async updateItem(
    userId: string,
    itemId: string,
    quantity: number,
    variantSelection?: Record<string, string>,
  ) {
    // Load the cart relation to verify ownership without creating a new cart.
    const item = await this.items.findOne({
      where: { id: itemId },
      relations: ['cart'],
    });
    if (!item || item.cart.userId !== userId) {
      throw new NotFoundException('Cart item not found');
    }
    if (quantity <= 0) {
      await this.items.remove(item);
    } else {
      item.quantity = quantity;
      if (variantSelection !== undefined) {
        item.variantSelection = variantSelection;
      }
      await this.items.save(item);
    }
    return this.getCart(userId);
  }

  async clearCart(cartId: string) {
    await this.items.delete({ cartId });
  }

  private toResponse(cart: Cart) {
    let subtotal = 0;
    let currency = '';
    for (const i of cart.items || []) {
      if (!i.product) continue;
      const unit = parseFloat(
        this.productsService.resolveVariantPrice(i.product, i.variantSelection),
      );
      if (Number.isFinite(unit)) {
        subtotal += unit * i.quantity;
      }
      // Take currency from the first item that has one — don't overwrite.
      if (!currency && i.product.currency) {
        currency = i.product.currency;
      }
    }
    const pricing = computePricing(subtotal);
    return {
      id: cart.id,
      subtotal: subtotal.toFixed(2),
      serviceCharge: pricing.serviceCharge.toFixed(2),
      discount: pricing.discount.toFixed(2),
      fees: pricing.fees.toFixed(2),
      total: pricing.total.toFixed(2),
      currency: currency || 'USD',
      items: (cart.items || []).map((i) => ({
        id: i.id,
        quantity: i.quantity,
        variantSelection: i.variantSelection,
        product: i.product
          ? this.productsService.toResponse(i.product)
          : { id: i.productId },
      })),
    };
  }

  async assertCartHasItems(userId: string): Promise<Cart> {
    const cart = await this.getOrCreateCart(userId);
    if (!cart.items?.length) {
      throw new BadRequestException('Cart is empty');
    }
    return cart;
  }
}
