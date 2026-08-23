import { Injectable } from '@nestjs/common';
import { ShippingRatesService } from './shipping-rates.service';
import { ShippingQuoteDto } from './dto/shipping-quote.dto';

export type ShippingQuoteResult = {
  actualWeight: number;
  dimWeight: number;
  billableWeight: number;
  baseRate: number;
  tvFee: number;
  bulkSurcharge: number;
  insuranceUsd: number;
  total: number;
  breakdown: string[];
};

@Injectable()
export class ShippingService {
  constructor(private readonly ratesService: ShippingRatesService) {}

  async calculate(dto: ShippingQuoteDto): Promise<ShippingQuoteResult> {
    const rates = await this.ratesService.getRates();

    const {
      weight,
      length = 0,
      width = 0,
      height = 0,
      destination,
      service,
      bulkCommercial = false,
      isTV = false,
      declaredValueUsd = 0,
      insurance = false,
    } = dto;

    const insuranceUsd =
      insurance && destination === 'lagos' && declaredValueUsd > 0
        ? parseFloat(
            (declaredValueUsd * rates.cargoInsuranceRateLagos).toFixed(2),
          )
        : 0;
    const insuranceBreakdown = insuranceUsd > 0
      ? [
          `Cargo insurance: ${(rates.cargoInsuranceRateLagos * 100).toFixed(0)}% of $${declaredValueUsd.toFixed(2)} declared value = $${insuranceUsd.toFixed(2)}`,
        ]
      : [];

    if (service === 'ocean_small') {
      const total = rates.oceanSmallBoxRate + insuranceUsd;
      return {
        actualWeight: weight,
        dimWeight: 0,
        billableWeight: weight,
        baseRate: rates.oceanSmallBoxRate,
        tvFee: 0,
        bulkSurcharge: 0,
        insuranceUsd,
        total,
        breakdown: [
          `Ocean small box flat rate: $${rates.oceanSmallBoxRate.toFixed(2)}`,
          ...insuranceBreakdown,
        ],
      };
    }

    // Air freight
    const dimWeight =
      length > 0 && width > 0 && height > 0
        ? (length * width * height) / rates.dimDivisor
        : 0;

    const billableWeight = Math.max(weight, dimWeight);
    const ratePerLb =
      destination === 'lagos'
        ? rates.airRateLagosPerLb
        : rates.airRateOutsideLagosPerLb;

    const breakdown: string[] = [];

    const baseRate = billableWeight * ratePerLb;
    breakdown.push(
      `${billableWeight.toFixed(2)} billable lbs × $${ratePerLb.toFixed(2)}/lb = $${baseRate.toFixed(2)}`,
    );

    if (dimWeight > weight && length > 0) {
      breakdown.push(
        `Dimensional weight used: (${length}×${width}×${height}) / ${rates.dimDivisor} = ${dimWeight.toFixed(2)} lbs > actual ${weight} lbs`,
      );
    }

    const tvFee = isTV ? rates.tvClearingFee : 0;
    if (isTV) {
      breakdown.push(`TV clearing fee: $${rates.tvClearingFee.toFixed(2)}`);
    }

    const bulkSurcharge = bulkCommercial ? rates.bulkCommercialSurcharge : 0;
    if (bulkCommercial) {
      breakdown.push(
        `Bulk/commercial surcharge: $${rates.bulkCommercialSurcharge.toFixed(2)}`,
      );
    }

    breakdown.push(...insuranceBreakdown);

    const total = baseRate + tvFee + bulkSurcharge + insuranceUsd;
    breakdown.push(`Total: $${total.toFixed(2)}`);

    return {
      actualWeight: weight,
      dimWeight: parseFloat(dimWeight.toFixed(2)),
      billableWeight: parseFloat(billableWeight.toFixed(2)),
      baseRate: parseFloat(baseRate.toFixed(2)),
      tvFee,
      bulkSurcharge,
      insuranceUsd,
      total: parseFloat(total.toFixed(2)),
      breakdown,
    };
  }
}
