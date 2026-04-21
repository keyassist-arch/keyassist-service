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
    let cart = await this.carts.findOne({
      where: { userId },
      relations: ['items', 'items.product'],
    });
    if (!cart) {
      const created = this.carts.create({ userId });
      await this.carts.save(created);
      cart = await this.carts.findOne({
        where: { id: created.id },
        relations: ['items', 'items.product'],
      });
    }
    if (!cart) {
      throw new BadRequestException('Could not create cart');
    }
    return cart;
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
   * Merges guest/local cart lines into the user's server cart (quantities add for same productId,
   * same rules as repeated `POST /cart/items`).
   */
  async mergeLocalCart(
    userId: string,
    items: Array<{
      productId: string;
      quantity: number;
      variantSelection?: Record<string, string>;
    }>,
  ) {
    const cart = await this.getOrCreateCart(userId);
    for (const line of items) {
      await this.applyLineToCart(
        cart.id,
        line.productId,
        line.quantity,
        line.variantSelection,
      );
    }
    return this.getCart(userId);
  }

  private async applyLineToCart(
    cartId: string,
    productId: string,
    quantity: number,
    variantSelection?: Record<string, string>,
  ): Promise<void> {
    await this.productsService.findById(productId);
    let item = await this.items.findOne({
      where: { cartId, productId },
    });
    if (item) {
      item.quantity += quantity;
      if (variantSelection) item.variantSelection = variantSelection;
      await this.items.save(item);
    } else {
      item = this.items.create({
        cartId,
        productId,
        quantity,
        variantSelection: variantSelection ?? null,
      });
      await this.items.save(item);
    }
  }

  async removeItem(userId: string, itemId: string) {
    const cart = await this.getOrCreateCart(userId);
    const res = await this.items.delete({ id: itemId, cartId: cart.id });
    if (!res.affected) {
      throw new NotFoundException('Cart item not found');
    }
    return this.getCart(userId);
  }

  async updateQuantity(userId: string, itemId: string, quantity: number) {
    const cart = await this.getOrCreateCart(userId);
    const item = await this.items.findOne({
      where: { id: itemId, cartId: cart.id },
    });
    if (!item) {
      throw new NotFoundException('Cart item not found');
    }
    if (quantity <= 0) {
      await this.items.remove(item);
    } else {
      item.quantity = quantity;
      await this.items.save(item);
    }
    return this.getCart(userId);
  }

  async clearCart(cartId: string) {
    await this.items.delete({ cartId });
  }

  private toResponse(cart: Cart) {
    let subtotal = 0;
    let currency = 'USD';
    for (const i of cart.items || []) {
      if (!i.product) continue;
      const unit = parseFloat(i.product.salePrice);
      if (Number.isFinite(unit)) {
        subtotal += unit * i.quantity;
      }
      if (i.product.currency) {
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
      currency,
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
