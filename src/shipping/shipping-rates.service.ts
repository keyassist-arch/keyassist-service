import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ShippingRates } from './entities/shipping-rates.entity';
import { UpdateShippingRatesDto } from './dto/update-shipping-rates.dto';
import {
  AIR_MINIMUM_LAGOS,
  AIR_MINIMUM_OUTSIDE_LAGOS,
  AIR_RATE_LAGOS_PER_LB,
  AIR_RATE_OUTSIDE_LAGOS_PER_LB,
  BULK_COMMERCIAL_SURCHARGE,
  DIM_DIVISOR,
  MIN_WEIGHT_LBS,
  OCEAN_SMALL_BOX_RATE,
  TV_CLEARING_FEE,
} from './utils/kingz-rates';

export type ResolvedRates = {
  airRateLagosPerLb: number;
  airRateOutsideLagosPerLb: number;
  dimDivisor: number;
  airMinimumLagos: number;
  airMinimumOutsideLagos: number;
  minWeightLbs: number;
  bulkCommercialSurcharge: number;
  tvClearingFee: number;
  oceanSmallBoxRate: number;
};

const DEFAULTS: ResolvedRates = {
  airRateLagosPerLb: AIR_RATE_LAGOS_PER_LB,
  airRateOutsideLagosPerLb: AIR_RATE_OUTSIDE_LAGOS_PER_LB,
  dimDivisor: DIM_DIVISOR,
  airMinimumLagos: AIR_MINIMUM_LAGOS,
  airMinimumOutsideLagos: AIR_MINIMUM_OUTSIDE_LAGOS,
  minWeightLbs: MIN_WEIGHT_LBS,
  bulkCommercialSurcharge: BULK_COMMERCIAL_SURCHARGE,
  tvClearingFee: TV_CLEARING_FEE,
  oceanSmallBoxRate: OCEAN_SMALL_BOX_RATE,
};

@Injectable()
export class ShippingRatesService implements OnModuleInit {
  private readonly logger = new Logger(ShippingRatesService.name);
  private cache: ResolvedRates | null = null;

  constructor(
    @InjectRepository(ShippingRates)
    private readonly repo: Repository<ShippingRates>,
  ) {}

  async onModuleInit() {
    await this.load();
  }

  async getRates(): Promise<ResolvedRates> {
    if (this.cache) return this.cache;
    return this.load();
  }

  async update(dto: UpdateShippingRatesDto): Promise<ShippingRates> {
    let row = await this.repo.findOne({ where: { id: 1 } });
    if (!row) {
      row = this.repo.create({ id: 1, ...this.dtoToEntity(dto) });
    } else {
      Object.assign(row, this.dtoToEntity(dto));
    }
    const saved = await this.repo.save(row);
    this.cache = null;
    await this.load();
    return saved;
  }

  async getRow(): Promise<ShippingRates | null> {
    return this.repo.findOne({ where: { id: 1 } });
  }

  private async load(): Promise<ResolvedRates> {
    try {
      const row = await this.repo.findOne({ where: { id: 1 } });
      if (row) {
        this.cache = {
          airRateLagosPerLb: parseFloat(row.airRateLagosPerLb),
          airRateOutsideLagosPerLb: parseFloat(row.airRateOutsideLagosPerLb),
          dimDivisor: row.dimDivisor,
          airMinimumLagos: parseFloat(row.airMinimumLagos),
          airMinimumOutsideLagos: parseFloat(row.airMinimumOutsideLagos),
          minWeightLbs: parseFloat(row.minWeightLbs),
          bulkCommercialSurcharge: parseFloat(row.bulkCommercialSurcharge),
          tvClearingFee: parseFloat(row.tvClearingFee),
          oceanSmallBoxRate: parseFloat(row.oceanSmallBoxRate),
        };
      } else {
        this.logger.warn(
          'No shipping_rates row found, using hardcoded defaults',
        );
        this.cache = DEFAULTS;
      }
    } catch (err) {
      this.logger.error(
        'Failed to load shipping rates from DB, using defaults',
        err,
      );
      this.cache = DEFAULTS;
    }
    return this.cache;
  }

  private dtoToEntity(dto: UpdateShippingRatesDto): Partial<ShippingRates> {
    const result: Partial<ShippingRates> = {};
    if (dto.airRateLagosPerLb !== undefined)
      result.airRateLagosPerLb = String(dto.airRateLagosPerLb);
    if (dto.airRateOutsideLagosPerLb !== undefined)
      result.airRateOutsideLagosPerLb = String(dto.airRateOutsideLagosPerLb);
    if (dto.dimDivisor !== undefined) result.dimDivisor = dto.dimDivisor;
    if (dto.airMinimumLagos !== undefined)
      result.airMinimumLagos = String(dto.airMinimumLagos);
    if (dto.airMinimumOutsideLagos !== undefined)
      result.airMinimumOutsideLagos = String(dto.airMinimumOutsideLagos);
    if (dto.minWeightLbs !== undefined)
      result.minWeightLbs = String(dto.minWeightLbs);
    if (dto.bulkCommercialSurcharge !== undefined)
      result.bulkCommercialSurcharge = String(dto.bulkCommercialSurcharge);
    if (dto.tvClearingFee !== undefined)
      result.tvClearingFee = String(dto.tvClearingFee);
    if (dto.oceanSmallBoxRate !== undefined)
      result.oceanSmallBoxRate = String(dto.oceanSmallBoxRate);
    return result;
  }
}
