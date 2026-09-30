import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { DiscountSettings } from './entities/discount-settings.entity';
import { UpdateDiscountSettingsDto } from './dto/update-discount-settings.dto';
import {
  DEFAULT_DISCOUNT_RATES,
  type DiscountRates,
} from '../common/utils/pricing.util';

@Injectable()
export class DiscountSettingsService implements OnModuleInit {
  private readonly logger = new Logger(DiscountSettingsService.name);
  private cache: DiscountRates | null = null;

  constructor(
    @InjectRepository(DiscountSettings)
    private readonly repo: Repository<DiscountSettings>,
  ) {}

  async onModuleInit() {
    await this.load();
  }

  async getRates(): Promise<DiscountRates> {
    if (this.cache) return this.cache;
    return this.load();
  }

  async getRow(): Promise<DiscountSettings> {
    const row = await this.repo.findOne({ where: { id: 1 } });
    return row ?? this.repo.create({ id: 1 });
  }

  async update(dto: UpdateDiscountSettingsDto): Promise<DiscountSettings> {
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

  private async load(): Promise<DiscountRates> {
    try {
      const row = await this.repo.findOne({ where: { id: 1 } });
      if (row) {
        this.cache = {
          firstOrderDiscountRate: parseFloat(row.firstOrderDiscountRate) || 0,
          volumeDiscountRate: parseFloat(row.volumeDiscountRate) || 0,
          volumeDiscountThresholdUsd:
            parseFloat(row.volumeDiscountThresholdUsd) || 0,
        };
      } else {
        this.logger.warn('No discount_settings row found, discounts disabled');
        this.cache = DEFAULT_DISCOUNT_RATES;
      }
    } catch (err) {
      this.logger.error(
        'Failed to load discount settings from DB, discounts disabled',
        err,
      );
      this.cache = DEFAULT_DISCOUNT_RATES;
    }
    return this.cache;
  }

  private dtoToEntity(
    dto: UpdateDiscountSettingsDto,
  ): Partial<DiscountSettings> {
    const result: Partial<DiscountSettings> = {};
    if (dto.firstOrderDiscountRate !== undefined)
      result.firstOrderDiscountRate = String(dto.firstOrderDiscountRate);
    if (dto.volumeDiscountRate !== undefined)
      result.volumeDiscountRate = String(dto.volumeDiscountRate);
    if (dto.volumeDiscountThresholdUsd !== undefined)
      result.volumeDiscountThresholdUsd = String(
        dto.volumeDiscountThresholdUsd,
      );
    return result;
  }
}
