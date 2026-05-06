import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import axios from 'axios';
import Redis from 'ioredis';
import { REDIS_CLIENT } from '../redis/redis.module';

/** All rates expressed as: 1 USD = N units of that currency */
type RateMap = Record<string, number>;

const RATES_CACHE_KEY = 'currency:rates:usd';
const RATES_TTL_SECONDS = 3_600;
const RATES_API_URL =
  'https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@latest/v1/currencies/usd.json';
const FALLBACK_API_URL =
  'https://latest.currency-api.pages.dev/v1/currencies/usd.json';

export interface ProductPricePayload {
  originalPrice: string;
  salePrice: string;
  currency: string;
  configurationPrices: Array<{
    originalPrice: string;
    salePrice: string;
    currency?: string;
    [key: string]: unknown;
  }>;
  [key: string]: unknown;
}

@Injectable()
export class CurrencyService {
  private readonly logger = new Logger(CurrencyService.name);

  constructor(
    @Optional()
    @Inject(REDIS_CLIENT)
    private readonly redis: Redis | null | undefined,
  ) {}

  private async fetchRates(): Promise<RateMap> {
    const tryFetch = async (url: string) => {
      const { data } = await axios.get<{ usd: RateMap }>(url, {
        timeout: 10_000,
      });
      return data?.usd ?? null;
    };
    try {
      const rates = await tryFetch(RATES_API_URL);
      if (rates) return rates;
    } catch {
      this.logger.warn('[currency] primary rate API failed, trying fallback');
    }
    const rates = await tryFetch(FALLBACK_API_URL);
    if (!rates) throw new Error('Both exchange rate APIs failed');
    return rates;
  }

  async getRates(): Promise<RateMap> {
    if (this.redis) {
      try {
        const cached = await this.redis.get(RATES_CACHE_KEY);
        if (cached) return JSON.parse(cached) as RateMap;
      } catch {
        // fall through to fresh fetch
      }
    }
    const rates = await this.fetchRates();
    if (this.redis) {
      try {
        await this.redis.set(
          RATES_CACHE_KEY,
          JSON.stringify(rates),
          'EX',
          RATES_TTL_SECONDS,
        );
      } catch {
        // non-fatal; rates still returned
      }
    }
    return rates;
  }

  /**
   * Convert `amount` from one ISO 4217 currency to another.
   * Rates are fetched fresh or from Redis cache (1-hour TTL).
   */
  async convert(amount: number, from: string, to: string): Promise<number> {
    const fromCode = from.toLowerCase();
    const toCode = to.toLowerCase();
    if (fromCode === toCode) return amount;
    const rates = await this.getRates();
    const fromRate = rates[fromCode];
    const toRate = rates[toCode];
    if (fromRate == null)
      throw new Error(`Unknown currency: ${from.toUpperCase()}`);
    if (toRate == null)
      throw new Error(`Unknown currency: ${to.toUpperCase()}`);
    // rates map: 1 USD = N of currency.  Convert via USD as base.
    return (amount / fromRate) * toRate;
  }

  /**
   * Convert all price fields in a product API response to `displayCurrency`.
   * Falls back to the original response (with a warning) if conversion fails.
   */
  async convertProductResponse<T extends ProductPricePayload>(
    response: T,
    displayCurrency: string,
  ): Promise<T & { displayCurrency: string }> {
    const target = displayCurrency.toUpperCase();
    const source = (response.currency ?? '').toUpperCase();

    if (!source || source === target) {
      return { ...response, displayCurrency: target };
    }

    try {
      const [origConverted, saleConverted] = await Promise.all([
        this.convert(parseFloat(response.originalPrice), source, target),
        this.convert(parseFloat(response.salePrice), source, target),
      ]);

      const configPrices = await Promise.all(
        (response.configurationPrices ?? []).map(async (row) => {
          const rowSrc = (row.currency ?? source).toUpperCase();
          try {
            const [rowOrig, rowSale] = await Promise.all([
              this.convert(parseFloat(row.originalPrice), rowSrc, target),
              this.convert(parseFloat(row.salePrice), rowSrc, target),
            ]);
            return {
              ...row,
              originalPrice: rowOrig.toFixed(2),
              salePrice: rowSale.toFixed(2),
              currency: target,
            };
          } catch {
            return row;
          }
        }),
      );

      return {
        ...response,
        originalPrice: origConverted.toFixed(2),
        salePrice: saleConverted.toFixed(2),
        currency: target,
        configurationPrices: configPrices,
        displayCurrency: target,
      };
    } catch (err) {
      this.logger.warn(
        `[currency] conversion failed from=${source} to=${target}: ${err instanceof Error ? err.message : String(err)}`,
      );
      return { ...response, displayCurrency: source };
    }
  }
}
