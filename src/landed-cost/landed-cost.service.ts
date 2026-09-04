import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Product } from '../products/entities/product.entity';
import { ProductSource } from '../common/enums/product-source.enum';
import { CurrencyService } from '../currency/currency.service';
import {
  SERVICE_CHARGE_RATE,
  PRODUCT_TAX_RATE,
  DISCOUNT_RATE,
  DISCOUNT_THRESHOLD_USD,
} from '../common/utils/pricing.util';
import { MARKETPLACE_ESTIMATES } from './rules/marketplace-estimates';
import { CATEGORY_WEIGHT_RULES, type ProductCategory } from './rules/category-weights';
import { NIGERIA_CUSTOMS_RATES } from './rules/customs-rates';
import type { LandedCostBreakdown } from './interfaces/landed-cost-breakdown.interface';
import type { LandedCostQuoteDto } from './dto/landed-cost-quote.dto';
import type { ShippingDestination, ShippingService as ShippingServiceType } from '../shipping/utils/kingz-rates';

export type CartLineInput = {
  priceUsd: number;
  marketplace: ProductSource;
  qty: number;
};

export type CartLandedCostOpts = {
  destination: ShippingDestination;
  shippingService: ShippingServiceType;
  category: ProductCategory;
};

/** Flat box packaging and warehouse handling fee per shipment (USD) */
const BOX_HANDLING_FEE_USD = 6.0;
const DOMESTIC_HANDLING_FEE_USD = 6.0;

/** Cargo insurance rate (3% of product subtotal, e.g. $7.50 on $250) */
const CARGO_INSURANCE_RATE = 0.03;

/** Base last-mile handling & customs clearance fee */
const BASE_IMPORT_CLEARANCE_USD = 5.0;

// Buffers removed — the 10% service charge provides sufficient gross margin
// to absorb minor price drift and FX movement without charging users twice.
const FX_BUFFER_RATE = 0;
const RISK_BUFFER_RATE = 0;

/**
 * Simplified air cargo weight bands (USA → Nigeria).
 * Assumes freight-forwarder consolidation economics, not express courier pricing.
 * Outside-Lagos adds a flat premium for last-mile delivery.
 */
const CARGO_BANDS_LAGOS: Array<{ maxLbs: number; rateUsd: number }> = [
  { maxLbs: 2,   rateUsd: 11 },
  { maxLbs: 5,   rateUsd: 25 },
  { maxLbs: 10,  rateUsd: 50 },
  { maxLbs: 20,  rateUsd: 90 },
  { maxLbs: Infinity, rateUsd: 0 }, // per-lb fallback below
];
const CARGO_RATE_PER_LB_HEAVY_LAGOS = 5.0;      // > 20 lbs
const CARGO_OUTSIDE_LAGOS_PREMIUM = 15;

function cargoRate(weightLbs: number, destination: ShippingDestination): number {
  const band = CARGO_BANDS_LAGOS.find((b) => weightLbs <= b.maxLbs);
  const base = band && band.rateUsd > 0
    ? band.rateUsd
    : Math.round(weightLbs * CARGO_RATE_PER_LB_HEAVY_LAGOS * 100) / 100;
  return destination === 'outside_lagos' ? base + CARGO_OUTSIDE_LAGOS_PREMIUM : base;
}

@Injectable()
export class LandedCostService {
  private readonly logger = new Logger(LandedCostService.name);

  constructor(
    @InjectRepository(Product)
    private readonly products: Repository<Product>,
    private readonly currencyService: CurrencyService,
  ) {}

  async quote(dto: LandedCostQuoteDto): Promise<LandedCostBreakdown> {
    const { marketplace, productPriceUsd, category, destination, shippingService, displayCurrency } =
      await this.resolveInputs(dto);

    const estimate = MARKETPLACE_ESTIMATES[marketplace];
    const weightRule = CATEGORY_WEIGHT_RULES[category];
    const customsRule = NIGERIA_CUSTOMS_RATES[category];

    const weight = dto.weightLbs ?? weightRule.weightLbs;

    // ── 1. Source marketplace costs ──────────────────────────────────────────
    const productSubtotal = round(productPriceUsd * dto.quantity);
    const taxRate = estimate.taxRate > 0 ? estimate.taxRate : PRODUCT_TAX_RATE;
    const marketplaceTax = round(productSubtotal * taxRate);
    const marketplaceShipping = round(estimate.domesticShippingUsd);

    // ── 2. Logistics & Handling ──────────────────────────────────────────────
    const boxHandlingFee = BOX_HANDLING_FEE_USD;
    const domesticHandling = boxHandlingFee;
    const cargoInsurance = round(productSubtotal * CARGO_INSURANCE_RATE);
    const internationalShipping = cargoRate(weight * dto.quantity, destination as ShippingDestination);
    const importClearance = BASE_IMPORT_CLEARANCE_USD;

    // ── 3. Customs (product subtotal basis — no CIF pyramiding) ─────────────
    const customsDuty = round(productSubtotal * (customsRule?.combinedRate ?? 0));
    const customsVat = 0;
    const customsClearingFee = 0;

    // ── 4. Buffers (product subtotal basis only) ─────────────────────────────
    const fxBuffer = round(productSubtotal * FX_BUFFER_RATE);
    const riskBuffer = round(productSubtotal * RISK_BUFFER_RATE);

    // ── 5. Our margin ────────────────────────────────────────────────────────
    const serviceCharge = round(productSubtotal * SERVICE_CHARGE_RATE);
    const discount = productSubtotal > DISCOUNT_THRESHOLD_USD
      ? round(productSubtotal * DISCOUNT_RATE)
      : 0;

    // ── 6. Import & Delivery Total ───────────────────────────────────────────
    const importAndDelivery = round(
      internationalShipping +
      boxHandlingFee +
      cargoInsurance +
      importClearance +
      marketplaceShipping +
      customsDuty,
    );

    // ── 7. Grand total ───────────────────────────────────────────────────────
    const totalUsd = round(
      productSubtotal + marketplaceTax + importAndDelivery + fxBuffer + riskBuffer + serviceCharge - discount,
    );

    // ── 8. Currency conversion ───────────────────────────────────────────────
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

    // ── 9. Breakdown lines ───────────────────────────────────────────────────
    const breakdown = buildBreakdown({
      productSubtotal,
      importAndDelivery,
      shippingService: shippingService as ShippingServiceType,
      destination: destination as ShippingDestination,
      internationalShipping,
      boxHandlingFee,
      cargoInsurance,
      serviceCharge,
      discount,
      totalUsd,
      totalDisplay,
      targetCurrency,
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
      boxHandlingFeeUsd: boxHandlingFee,
      cargoInsuranceUsd: cargoInsurance,
      internationalShippingUsd: internationalShipping,
      importAndDeliveryUsd: importAndDelivery,
      customsDutyUsd: customsDuty,
      customsVatUsd: customsVat,
      customsClearingFeeUsd: customsClearingFee,
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
    const customsRule = NIGERIA_CUSTOMS_RATES[category];

    // ── 1. Source marketplace costs ──────────────────────────────────────────
    const productSubtotal = round(lines.reduce((s, l) => s + l.priceUsd * l.qty, 0));

    let marketplaceTax = 0;
    const seenMarketplaces = new Set<ProductSource>();
    let marketplaceShipping = 0;
    let lowestConfidence: 'high' | 'medium' | 'low' = 'high';
    const confidenceOrder = { high: 0, medium: 1, low: 2 };

    for (const line of lines) {
      const est = MARKETPLACE_ESTIMATES[line.marketplace];
      const taxRate = est.taxRate > 0 ? est.taxRate : PRODUCT_TAX_RATE;
      marketplaceTax += line.priceUsd * line.qty * taxRate;
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

    // ── 2. Logistics & Handling ──────────────────────────────────────────────
    const boxHandlingFee = BOX_HANDLING_FEE_USD;
    const domesticHandling = boxHandlingFee;
    const cargoInsurance = round(productSubtotal * CARGO_INSURANCE_RATE);
    const totalQty = lines.reduce((s, l) => s + l.qty, 0);
    const totalWeight = weightRule.weightLbs * totalQty;
    const internationalShipping = cargoRate(totalWeight, destination);
    const importClearance = BASE_IMPORT_CLEARANCE_USD;

    // ── 3. Customs (product subtotal basis — no CIF pyramiding) ─────────────
    const customsDuty = round(productSubtotal * (customsRule?.combinedRate ?? 0));
    const customsVat = 0;
    const customsClearingFee = 0;

    // ── 4. Buffers (product subtotal basis only) ─────────────────────────────
    const fxBuffer = round(productSubtotal * FX_BUFFER_RATE);
    const riskBuffer = round(productSubtotal * RISK_BUFFER_RATE);

    // ── 5. Margin ────────────────────────────────────────────────────────────
    const serviceCharge = round(productSubtotal * SERVICE_CHARGE_RATE);
    const discount =
      productSubtotal > DISCOUNT_THRESHOLD_USD
        ? round(productSubtotal * DISCOUNT_RATE)
        : 0;

    // ── 6. Import & Delivery Total ───────────────────────────────────────────
    const importAndDelivery = round(
      internationalShipping +
      boxHandlingFee +
      cargoInsurance +
      importClearance +
      marketplaceShipping +
      customsDuty,
    );

    // ── 7. Grand total ───────────────────────────────────────────────────────
    const totalUsd = round(
      productSubtotal + marketplaceTax + importAndDelivery + fxBuffer + riskBuffer + serviceCharge - discount,
    );

    // Use the marketplace with the highest subtotal for the single `marketplace` field
    const dominantMarketplace = lines.reduce((best, l) =>
      l.priceUsd * l.qty > best.priceUsd * best.qty ? l : best,
    ).marketplace;

    const breakdown = buildBreakdown({
      productSubtotal,
      importAndDelivery,
      shippingService,
      destination,
      internationalShipping,
      boxHandlingFee,
      cargoInsurance,
      serviceCharge,
      discount,
      totalUsd,
      totalDisplay: totalUsd,
      targetCurrency: 'USD',
    });

    this.logger.log(
      `[landed-cost] cart lines=${lines.length} category=${category} ` +
      `destination=${destination} totalUsd=${totalUsd}`,
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
      boxHandlingFeeUsd: boxHandlingFee,
      cargoInsuranceUsd: cargoInsurance,
      internationalShippingUsd: internationalShipping,
      importAndDeliveryUsd: importAndDelivery,
      customsDutyUsd: customsDuty,
      customsVatUsd: customsVat,
      customsClearingFeeUsd: customsClearingFee,
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
  boxHandlingFee?: number;
  cargoInsurance?: number;
  serviceCharge: number;
  discount: number;
  totalUsd: number;
  totalDisplay: number;
  targetCurrency: string;
}): string[] {
  const fmt = (n: number) => `$${n.toFixed(2)}`;
  const dest = parts.destination === 'outside_lagos' ? 'outside Lagos' : 'Lagos';
  const lines: string[] = [];

  // Simplified UI breakdown — clean, transparent, minimal
  lines.push(`Product: ${fmt(parts.productSubtotal)}`);
  lines.push(`Import & Delivery (${dest}): ${fmt(parts.importAndDelivery)}`);
  if (parts.internationalShipping > 0) {
    lines.push(`  incl. intl cargo: ${fmt(parts.internationalShipping)}`);
  }
  if (parts.boxHandlingFee && parts.boxHandlingFee > 0) {
    lines.push(`  incl. box/handling fee: ${fmt(parts.boxHandlingFee)}`);
  }
  if (parts.cargoInsurance && parts.cargoInsurance > 0) {
    lines.push(`  incl. cargo insurance: ${fmt(parts.cargoInsurance)}`);
  }
  lines.push(`Service Fee: ${fmt(parts.serviceCharge)}`);

  if (parts.discount > 0) {
    lines.push(`Loyalty discount: -${fmt(parts.discount)}`);
  }

  lines.push(`─────────────────────────────`);
  lines.push(`Estimated total (USD): ${fmt(parts.totalUsd)}`);

  if (parts.targetCurrency !== 'USD') {
    lines.push(`Estimated total (${parts.targetCurrency}): ${parts.totalDisplay.toFixed(2)}`);
  }

  return lines;
}
