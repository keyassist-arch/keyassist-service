import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Product } from '../products/entities/product.entity';
import { ProductSource } from '../common/enums/product-source.enum';
import { CurrencyService } from '../currency/currency.service';
import { ShippingService } from '../shipping/shipping.service';
import { CartService } from '../cart/cart.service';
import { ProductsService } from '../products/products.service';
import {
  computePlatformFee,
  PRODUCT_TAX_RATE,
  DISCOUNT_RATE,
  DISCOUNT_THRESHOLD_USD,
} from '../common/utils/pricing.util';
import { MARKETPLACE_ESTIMATES } from './rules/marketplace-estimates';
import { CATEGORY_WEIGHT_RULES, type ProductCategory } from './rules/category-weights';
import type { LandedCostBreakdown } from './interfaces/landed-cost-breakdown.interface';
import type { LandedCostQuoteDto } from './dto/landed-cost-quote.dto';
import type { LandedCostCartQuoteDto } from './dto/landed-cost-cart-quote.dto';
import type { ShippingDestination, ShippingService as ShippingServiceType } from '../shipping/utils/kingz-rates';

export type CartLineInput = {
  priceUsd: number;
  marketplace: ProductSource;
  qty: number;
  weightLbs?: number;
  dimensions?: { lengthIn: number; widthIn: number; heightIn: number };
  category?: ProductCategory;
  isTV?: boolean;
};

export type CartLandedCostOpts = {
  destination: ShippingDestination;
  shippingService: ShippingServiceType;
  category: ProductCategory;
  insurance?: boolean;
};

/**
 * Box / warehouse packaging & handling fee per shipment (USD).
 * Matches the "Box / Handling Fee — Updated warehouse packaging fee" line on the Kingz
 * invoice. Billed inside the import & delivery fee, never as its own invoice line.
 */
const DOMESTIC_HANDLING_FEE_USD = 6.0;

const FX_BUFFER_RATE = 0;
const RISK_BUFFER_RATE = 0;

@Injectable()
export class LandedCostService {
  private readonly logger = new Logger(LandedCostService.name);

  constructor(
    @InjectRepository(Product)
    private readonly products: Repository<Product>,
    private readonly currencyService: CurrencyService,
    private readonly shippingService: ShippingService,
    private readonly cartService: CartService,
    private readonly productsService: ProductsService,
  ) {}

  async quote(dto: LandedCostQuoteDto): Promise<LandedCostBreakdown> {
    const { marketplace, productPriceUsd, category, destination, shippingService, displayCurrency } =
      await this.resolveInputs(dto);

    const estimate = MARKETPLACE_ESTIMATES[marketplace];
    const weightRule = CATEGORY_WEIGHT_RULES[category];

    const weight = dto.weightLbs ?? weightRule.weightLbs;
    const dims = dto.dimensions ?? {
      lengthIn: weightRule.lengthIn,
      widthIn: weightRule.widthIn,
      heightIn: weightRule.heightIn,
    };

    // ── 1. Item cost (COGS) — goods + US sales tax ───────────────────────────
    const productSubtotal = round(productPriceUsd * dto.quantity);
    const taxRate = estimate.taxRate > 0 ? estimate.taxRate : PRODUCT_TAX_RATE;
    // Prefer an actual tax amount from the scraper/checkout over the rate estimate.
    const marketplaceTax =
      dto.taxAmountUsd != null
        ? round(dto.taxAmountUsd)
        : round(productSubtotal * taxRate);
    const itemCost = round(productSubtotal + marketplaceTax);
    const marketplaceShipping = round(estimate.domesticShippingUsd);

    // ── 2. International logistics (Kingz, USA → Nigeria) ───────────────────
    const domesticHandling = DOMESTIC_HANDLING_FEE_USD;
    const isTV = category === 'tv';
    const kQuote = await this.shippingService.calculate({
      weight: weight * dto.quantity,
      length: dims.lengthIn,
      width: dims.widthIn,
      height: dims.heightIn * dto.quantity, // stack height for qty > 1
      destination: destination as ShippingDestination,
      service: shippingService === 'air' ? 'air' : 'ocean_small',
      isTV,
      bulkCommercial: false,
      // Insurance is priced on item cost only, not the full landed value.
      declaredValueUsd: productSubtotal,
      insurance: dto.insurance ?? false,
    });
    // Keep freight and insurance as separate breakdown lines rather than
    // folding insurance into the "all-inclusive" Kingz rate.
    const insuranceUsd = kQuote.insuranceUsd;
    const internationalShipping = kQuote.total - insuranceUsd;

    // ── 3. Buffers (product subtotal basis only) ─────────────────────────────
    const fxBuffer = round(productSubtotal * FX_BUFFER_RATE);
    const riskBuffer = round(productSubtotal * RISK_BUFFER_RATE);

    // ── 4. Our margin ────────────────────────────────────────────────────────
    const serviceCharge = computePlatformFee(productSubtotal);
    const discount = productSubtotal > DISCOUNT_THRESHOLD_USD
      ? round(productSubtotal * DISCOUNT_RATE)
      : 0;

    // ── 5. Import & Delivery Total ───────────────────────────────────────────
    const importAndDelivery = round(
      marketplaceShipping + domesticHandling + internationalShipping,
    );

    // ── 6. Grand total ───────────────────────────────────────────────────────
    const totalUsd = round(
      itemCost + importAndDelivery + insuranceUsd +
        fxBuffer + riskBuffer + serviceCharge - discount,
    );

    // ── 7. Currency conversion ───────────────────────────────────────────────
    let totalDisplay = totalUsd;
    const targetCurrency = (displayCurrency ?? 'USD').toUpperCase();
    if (targetCurrency !== 'USD') {
      try {
        totalDisplay = round(await this.currencyService.convert(totalUsd, 'USD', targetCurrency));
      } catch (err) {
        this.logger.warn(
          `[landed-cost] currency conversion to ${targetCurrency} failed: ${err instanceof Error ? err.message : String(err)}`,
        );
        totalDisplay = totalUsd;
      }
    }

    // ── 8. Breakdown lines ───────────────────────────────────────────────────
    const breakdown = buildBreakdown({
      productSubtotal,
      marketplaceTax,
      taxRate: dto.taxAmountUsd != null ? (productSubtotal > 0 ? marketplaceTax / productSubtotal : 0) : taxRate,
      itemCost,
      importAndDelivery,
      destination: destination as ShippingDestination,
      insuranceUsd,
      serviceCharge,
      discount,
      totalUsd,
    });

    this.logger.log(
      `[landed-cost] marketplace=${marketplace} category=${category} qty=${dto.quantity} totalUsd=${totalUsd}`,
    );

    return {
      marketplace,
      category,
      quantity: dto.quantity,
      estimatedWeightLbs: weight,
      marketplaceConfidence: estimate.confidence,
      productSubtotalUsd: productSubtotal,
      marketplaceTaxUsd: marketplaceTax,
      taxRate: dto.taxAmountUsd != null ? 0 : taxRate,
      itemCostUsd: itemCost,
      marketplaceShippingUsd: marketplaceShipping,
      domesticHandlingUsd: domesticHandling,
      boxHandlingFeeUsd: domesticHandling,
      cargoInsuranceUsd: insuranceUsd,
      internationalShippingUsd: internationalShipping,
      importAndDeliveryUsd: importAndDelivery,
      insuranceUsd,
      fxBufferUsd: fxBuffer,
      riskBufferUsd: riskBuffer,
      serviceChargeUsd: serviceCharge,
      discountUsd: discount,
      totalUsd,
      displayCurrency: targetCurrency,
      totalDisplay,
      breakdown,
    };
  }

  /**
   * Compute landed cost for a multi-item cart.
   * Handles mixed marketplaces: domestic shipping is summed per unique source,
   * tax is calculated per line, weight is aggregated for a single Kingz shipment.
   */
  async quoteForCartLines(
    lines: CartLineInput[],
    opts: CartLandedCostOpts,
  ): Promise<LandedCostBreakdown> {
    if (!lines.length) {
      throw new BadRequestException('Cannot compute landed cost for an empty cart');
    }

    const { destination, shippingService, category, insurance = false } = opts;

    // ── 1. Item cost (COGS) — goods + US sales tax ───────────────────────────
    const productSubtotal = round(lines.reduce((s, l) => s + l.priceUsd * l.qty, 0));

    // Tax is per line: a mixed cart can hold US-taxed goods next to untaxed ones
    let taxableSubtotal = 0;
    let marketplaceTax = 0;
    const seenMarketplaces = new Set<ProductSource>();
    let marketplaceShipping = 0;
    let lowestConfidence: 'high' | 'medium' | 'low' = 'high';
    const confidenceOrder = { high: 0, medium: 1, low: 2 };

    for (const line of lines) {
      const est = MARKETPLACE_ESTIMATES[line.marketplace];
      const taxRate = est.taxRate > 0 ? est.taxRate : PRODUCT_TAX_RATE;
      const lineSubtotal = line.priceUsd * line.qty;
      marketplaceTax += lineSubtotal * taxRate;
      if (taxRate > 0) taxableSubtotal += lineSubtotal;
      if (!seenMarketplaces.has(line.marketplace)) {
        marketplaceShipping += est.domesticShippingUsd;
        seenMarketplaces.add(line.marketplace);
      }
      if (confidenceOrder[est.confidence] > confidenceOrder[lowestConfidence]) {
        lowestConfidence = est.confidence;
      }
    }
    marketplaceTax = round(marketplaceTax);
    const itemCost = round(productSubtotal + marketplaceTax);
    marketplaceShipping = round(marketplaceShipping);

    // ── 2. International logistics (Kingz, USA → Nigeria) ───────────────────
    const domesticHandling = DOMESTIC_HANDLING_FEE_USD;
    let totalWeight = 0;
    let hasTV = false;
    for (const line of lines) {
      const lineWeightRule = CATEGORY_WEIGHT_RULES[line.category ?? category];
      totalWeight += (line.weightLbs ?? lineWeightRule.weightLbs) * line.qty;
      if (line.category === 'tv' || (!line.category && category === 'tv')) hasTV = true;
    }
    const kQuote = await this.shippingService.calculate({
      weight: totalWeight,
      destination,
      service: shippingService === 'air' ? 'air' : 'ocean_small',
      isTV: hasTV,
      bulkCommercial: false,
      // Insurance is priced on item cost only, not the full landed value.
      declaredValueUsd: productSubtotal,
      insurance,
    });
    const insuranceUsd = kQuote.insuranceUsd;
    const internationalShipping = kQuote.total - insuranceUsd;
    const totalQty = lines.reduce((s, l) => s + l.qty, 0);

    // ── 3. Buffers (product subtotal basis only) ─────────────────────────────
    const fxBuffer = round(productSubtotal * FX_BUFFER_RATE);
    const riskBuffer = round(productSubtotal * RISK_BUFFER_RATE);

    // ── 4. Margin ────────────────────────────────────────────────────────────
    const serviceCharge = computePlatformFee(productSubtotal);
    const discount =
      productSubtotal > DISCOUNT_THRESHOLD_USD
        ? round(productSubtotal * DISCOUNT_RATE)
        : 0;

    // ── 5. Import & Delivery Total ───────────────────────────────────────────
    const importAndDelivery = round(
      marketplaceShipping + domesticHandling + internationalShipping,
    );

    // ── 6. Grand total ───────────────────────────────────────────────────────
    const totalUsd = round(
      itemCost + importAndDelivery + insuranceUsd +
        fxBuffer + riskBuffer + serviceCharge - discount,
    );

    // Use the marketplace with the highest subtotal for the single `marketplace` field
    const dominantMarketplace = lines.reduce((best, l) =>
      l.priceUsd * l.qty > best.priceUsd * best.qty ? l : best,
    ).marketplace;

    const breakdown = buildBreakdown({
      productSubtotal,
      marketplaceTax,
      taxRate: taxableSubtotal > 0 ? marketplaceTax / taxableSubtotal : PRODUCT_TAX_RATE,
      itemCost,
      importAndDelivery,
      destination,
      insuranceUsd,
      serviceCharge,
      discount,
      totalUsd,
    });

    this.logger.log(
      `[landed-cost] cart lines=${lines.length} category=${category} ` +
      `destination=${destination} actualWeightLbs=${totalWeight.toFixed(2)} ` +
      `billableWeightLbs=${kQuote.billableWeight} intlShipping=${internationalShipping} totalUsd=${totalUsd}`,
    );

    return {
      marketplace: dominantMarketplace,
      category,
      quantity: totalQty,
      estimatedWeightLbs: totalWeight,
      marketplaceConfidence: lowestConfidence,
      productSubtotalUsd: productSubtotal,
      marketplaceTaxUsd: marketplaceTax,
      // Effective rate across taxable lines only — equals US_SALES_TAX_RATE for an
      // all-US cart, lower once an untaxed line (Shein, Jumia) is mixed in.
      taxRate:
        taxableSubtotal > 0
          ? Math.round((marketplaceTax / taxableSubtotal) * 10_000) / 10_000
          : 0,
      itemCostUsd: itemCost,
      marketplaceShippingUsd: marketplaceShipping,
      domesticHandlingUsd: domesticHandling,
      boxHandlingFeeUsd: domesticHandling,
      cargoInsuranceUsd: insuranceUsd,
      internationalShippingUsd: internationalShipping,
      importAndDeliveryUsd: importAndDelivery,
      insuranceUsd,
      fxBufferUsd: fxBuffer,
      riskBufferUsd: riskBuffer,
      serviceChargeUsd: serviceCharge,
      discountUsd: discount,
      totalUsd,
      displayCurrency: 'USD',
      totalDisplay: totalUsd,
      breakdown,
    };
  }

  /**
   * Preview quote for the checkout confirm step. Mirrors `OrdersService.placeOrder()`'s
   * pricing step exactly (same price resolution, same `quoteForCartLines` aggregation)
   * so what the customer previews here matches what the order is actually created with —
   * unlike quoting a single cart line, which silently ignores the rest of the cart.
   */
  async quoteForUserCart(
    userId: string,
    opts: LandedCostCartQuoteDto,
  ): Promise<LandedCostBreakdown> {
    const cart = await this.cartService.getOrCreateCart(userId);
    const items = (cart.items ?? []).filter((i) => i.product);
    if (!items.length) {
      throw new BadRequestException('Cart is empty');
    }

    const lines: CartLineInput[] = items.map((i) => ({
      priceUsd: parseFloat(
        this.productsService.resolveVariantPrice(i.product, i.variantSelection),
      ),
      marketplace: i.product.source,
      qty: i.quantity,
    }));

    const breakdown = await this.quoteForCartLines(lines, {
      destination: opts.destination,
      shippingService: opts.shippingService,
      category: opts.category ?? 'generic',
      insurance: opts.insurance ?? false,
    });

    const targetCurrency = (opts.displayCurrency ?? 'USD').toUpperCase();
    if (targetCurrency === 'USD') return breakdown;

    try {
      const totalDisplay = round(
        await this.currencyService.convert(
          breakdown.totalUsd,
          'USD',
          targetCurrency,
        ),
      );
      return { ...breakdown, displayCurrency: targetCurrency, totalDisplay };
    } catch (err) {
      this.logger.warn(
        `[landed-cost] currency conversion to ${targetCurrency} failed: ${err instanceof Error ? err.message : String(err)}`,
      );
      return breakdown;
    }
  }

  private async resolveInputs(dto: LandedCostQuoteDto): Promise<{
    marketplace: ProductSource;
    productPriceUsd: number;
    category: ProductCategory;
    destination: string;
    shippingService: string;
    displayCurrency?: string;
  }> {
    const category: ProductCategory = dto.category ?? 'generic';

    if (dto.productId) {
      const product = await this.products.findOne({ where: { id: dto.productId } });
      if (!product) {
        throw new BadRequestException(`Product ${dto.productId} not found`);
      }
      // Convert product price to USD if needed
      let priceUsd = parseFloat(product.salePrice);
      if (product.currency.toUpperCase() !== 'USD') {
        try {
          priceUsd = await this.currencyService.convert(priceUsd, product.currency, 'USD');
        } catch {
          throw new BadRequestException(
            `Cannot convert ${product.currency} to USD for product ${dto.productId}`,
          );
        }
      }
      return {
        marketplace: product.source,
        productPriceUsd: priceUsd,
        category,
        destination: dto.destination,
        shippingService: dto.shippingService,
        displayCurrency: dto.displayCurrency,
      };
    }

    if (dto.productPriceUsd == null || dto.marketplace == null) {
      throw new BadRequestException(
        'Provide either productId or both productPriceUsd and marketplace',
      );
    }

    return {
      marketplace: dto.marketplace,
      productPriceUsd: dto.productPriceUsd,
      category,
      destination: dto.destination,
      shippingService: dto.shippingService,
      displayCurrency: dto.displayCurrency,
    };
  }
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * The simplified landed cost breakdown:
 * 1. Tax calculation note: e.g. 8.25% of Product price ($250.00) = $20.63 for tax
 * 2. Product (COGS): e.g. Product (COGS) - $250.00 + $20.63 = $270.63
 * 3. Shipping: total combined shipping (import, domestic handling, international cargo, insurance)
 * 4. Service fee: 10% of product or flat fee
 * 5. Total
 */
function buildBreakdown(parts: {
  productSubtotal: number;
  marketplaceTax: number;
  taxRate: number;
  itemCost: number;
  importAndDelivery: number;
  destination: ShippingDestination;
  insuranceUsd: number;
  serviceCharge: number;
  discount: number;
  totalUsd: number;
}): string[] {
  const fmt = (n: number) => `$${n.toFixed(2)}`;
  const lines: string[] = [];

  // Item cost (COGS) includes product price + marketplace sales tax added in the background
  lines.push(`Product (COGS): ${fmt(parts.itemCost)}`);

  const totalShipping = round(parts.importAndDelivery + parts.insuranceUsd);
  lines.push(`Shipping: ${fmt(totalShipping)}`);

  lines.push(`Service: ${fmt(parts.serviceCharge)}`);

  if (parts.discount > 0) {
    lines.push(`Discount: -${fmt(parts.discount)}`);
  }

  lines.push(`Total: ${fmt(parts.totalUsd)}`);

  return lines;
}
