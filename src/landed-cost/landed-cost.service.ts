import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Product } from '../products/entities/product.entity';
import { ProductSource } from '../common/enums/product-source.enum';
import { CurrencyService } from '../currency/currency.service';
import { ShippingService } from '../shipping/shipping.service';
import { computePlatformFee, DISCOUNT_RATE, DISCOUNT_THRESHOLD_USD } from '../common/utils/pricing.util';
import { MARKETPLACE_ESTIMATES } from './rules/marketplace-estimates';
import { CATEGORY_WEIGHT_RULES, type ProductCategory } from './rules/category-weights';
import type { LandedCostBreakdown } from './interfaces/landed-cost-breakdown.interface';
import type { LandedCostQuoteDto } from './dto/landed-cost-quote.dto';
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
};

/** Flat warehouse receiving/processing fee per shipment (USD) */
const DOMESTIC_HANDLING_FEE_USD = 8;

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

    // ── 1. Source marketplace costs ──────────────────────────────────────────
    const productSubtotal = round(productPriceUsd * dto.quantity);
    // Prefer an actual tax amount from the scraper/checkout over the flat estimate.
    const marketplaceTax =
      dto.taxAmountUsd != null
        ? round(dto.taxAmountUsd)
        : round(productSubtotal * estimate.taxRate);
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
    });
    const internationalShipping = kQuote.total;

    // ── 3. Buffers (product subtotal basis only) ─────────────────────────────
    const fxBuffer = round(productSubtotal * FX_BUFFER_RATE);
    const riskBuffer = round(productSubtotal * RISK_BUFFER_RATE);

    // ── 5. Our margin ────────────────────────────────────────────────────────
    const serviceCharge = computePlatformFee(productSubtotal);
    const discount = productSubtotal > DISCOUNT_THRESHOLD_USD
      ? round(productSubtotal * DISCOUNT_RATE)
      : 0;

    // ── 6. Grand total ───────────────────────────────────────────────────────
    const logisticsCost =
      marketplaceTax + marketplaceShipping + domesticHandling +
      internationalShipping;
    const totalUsd = round(
      productSubtotal + logisticsCost + fxBuffer + riskBuffer + serviceCharge - discount,
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
    const importAndDelivery =
      marketplaceTax + marketplaceShipping + domesticHandling + internationalShipping;
    const breakdown = buildBreakdown({
      productSubtotal, importAndDelivery,
      shippingService: shippingService as ShippingServiceType,
      destination: destination as ShippingDestination,
      internationalShipping,
      serviceCharge, discount,
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
      marketplaceShippingUsd: marketplaceShipping,
      domesticHandlingUsd: domesticHandling,
      internationalShippingUsd: internationalShipping,
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

    const { destination, shippingService, category } = opts;
    const weightRule = CATEGORY_WEIGHT_RULES[category];

    // ── 1. Source marketplace costs ──────────────────────────────────────────
    const productSubtotal = round(lines.reduce((s, l) => s + l.priceUsd * l.qty, 0));

    let marketplaceTax = 0;
    const seenMarketplaces = new Set<ProductSource>();
    let marketplaceShipping = 0;
    let lowestConfidence: 'high' | 'medium' | 'low' = 'high';
    const confidenceOrder = { high: 0, medium: 1, low: 2 };

    for (const line of lines) {
      const est = MARKETPLACE_ESTIMATES[line.marketplace];
      marketplaceTax += line.priceUsd * line.qty * est.taxRate;
      if (!seenMarketplaces.has(line.marketplace)) {
        marketplaceShipping += est.domesticShippingUsd;
        seenMarketplaces.add(line.marketplace);
      }
      if (confidenceOrder[est.confidence] > confidenceOrder[lowestConfidence]) {
        lowestConfidence = est.confidence;
      }
    }
    marketplaceTax = round(marketplaceTax);
    marketplaceShipping = round(marketplaceShipping);

    // ── 2. International logistics (Kingz, USA → Nigeria) ───────────────────
    // Aggregate all lines into a single billable weight for Kingz.
    // Each line contributes its own actual weight; dimensions use category defaults
    // unless the caller provides per-line dimensions.
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
    });
    const internationalShipping = kQuote.total;
    const totalQty = lines.reduce((s, l) => s + l.qty, 0);

    // ── 3. Buffers (product subtotal basis only) ─────────────────────────────
    const fxBuffer = round(productSubtotal * FX_BUFFER_RATE);
    const riskBuffer = round(productSubtotal * RISK_BUFFER_RATE);

    // ── 5. Margin ────────────────────────────────────────────────────────────
    const serviceCharge = computePlatformFee(productSubtotal);
    const discount =
      productSubtotal > DISCOUNT_THRESHOLD_USD
        ? round(productSubtotal * DISCOUNT_RATE)
        : 0;

    // ── 6. Grand total ───────────────────────────────────────────────────────
    const logisticsCost =
      marketplaceTax + marketplaceShipping + domesticHandling +
      internationalShipping;
    const totalUsd = round(
      productSubtotal + logisticsCost + fxBuffer + riskBuffer + serviceCharge - discount,
    );

    // Use the marketplace with the highest subtotal for the single `marketplace` field
    const dominantMarketplace = lines.reduce((best, l) =>
      l.priceUsd * l.qty > best.priceUsd * best.qty ? l : best,
    ).marketplace;

    const importAndDelivery =
      marketplaceTax + marketplaceShipping + domesticHandling + internationalShipping;
    const breakdown = buildBreakdown({
      productSubtotal, importAndDelivery,
      shippingService,
      destination,
      internationalShipping,
      serviceCharge, discount,
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
      marketplaceShippingUsd: marketplaceShipping,
      domesticHandlingUsd: domesticHandling,
      internationalShippingUsd: internationalShipping,
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

function buildBreakdown(parts: {
  productSubtotal: number;
  importAndDelivery: number;
  shippingService: ShippingServiceType;
  destination: ShippingDestination;
  internationalShipping: number;
  serviceCharge: number;
  discount: number;
  totalUsd: number;
}): string[] {
  const fmt = (n: number) => `$${n.toFixed(2)}`;
  const dest = parts.destination === 'outside_lagos' ? 'outside Lagos' : 'Lagos';
  const lines: string[] = [];

  // Three-line breakdown — keeps the UI simple and trustworthy
  lines.push(`Product: ${fmt(parts.productSubtotal)}`);
  lines.push(`Import & Delivery (${dest}): ${fmt(parts.importAndDelivery)}`);
  lines.push(`  incl. intl cargo: ${fmt(parts.internationalShipping)}`);
  lines.push(`Service Fee: ${fmt(parts.serviceCharge)}`);

  if (parts.discount > 0) {
    lines.push(`Loyalty discount: -${fmt(parts.discount)}`);
  }

  lines.push(`─────────────────────────────`);
  lines.push(`Estimated total (USD): ${fmt(parts.totalUsd)}`);

  return lines;
}
