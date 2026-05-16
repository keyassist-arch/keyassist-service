import {
  BadRequestException,
  Controller,
  DefaultValuePipe,
  Get,
  Param,
  ParseIntPipe,
  Query,
} from '@nestjs/common';
import { ApiOperation, ApiParam, ApiQuery, ApiTags } from '@nestjs/swagger';
import { Public } from '../common/decorators/public.decorator';
import { CurrencyService } from '../currency/currency.service';
import { ProductsService } from './products.service';

const RECENT_PRODUCTS_DEFAULT = 24;
const RECENT_PRODUCTS_MAX = 100;
const RELATED_DEFAULT_LIMIT = 8;
const RELATED_MAX_LIMIT = 20;

/** Loose ISO 4217 check — 3 uppercase letters */
function isValidCurrencyCode(code: string): boolean {
  return /^[A-Z]{3}$/.test(code.trim().toUpperCase());
}

@ApiTags('Products')
@Controller('products')
export class ProductsController {
  constructor(
    private readonly productsService: ProductsService,
    private readonly currencyService: CurrencyService,
  ) {}

  /** Recent products for storefront home / discovery — no auth. Full admin list: `GET /admin/products`. */
  @Public()
  @Get()
  @ApiQuery({
    name: 'limit',
    required: false,
    description: `Max products to return (default ${RECENT_PRODUCTS_DEFAULT}, max ${RECENT_PRODUCTS_MAX})`,
    example: RECENT_PRODUCTS_DEFAULT,
  })
  @ApiQuery({
    name: 'displayCurrency',
    required: false,
    description:
      'ISO 4217 currency code to convert prices into (e.g. USD, EUR, NGN). Rates are cached hourly.',
    example: 'USD',
  })
  async listRecent(
    @Query('limit', new DefaultValuePipe(RECENT_PRODUCTS_DEFAULT), ParseIntPipe)
    limit: number,
    @Query('displayCurrency') displayCurrency?: string,
  ) {
    const capped = Math.min(RECENT_PRODUCTS_MAX, Math.max(1, limit));
    const list = await this.productsService.findRecentForPublic(capped);
    const responses = list.map((p) => this.productsService.toResponse(p));

    if (!displayCurrency) return responses;

    const target = displayCurrency.trim().toUpperCase();
    if (!isValidCurrencyCode(target)) {
      throw new BadRequestException(
        `Invalid displayCurrency "${displayCurrency}" — must be a 3-letter ISO 4217 code (e.g. USD, EUR, NGN)`,
      );
    }

    return Promise.all(
      responses.map((r) =>
        this.currencyService.convertProductResponse(r, target),
      ),
    );
  }

  @Public()
  @Get(':idOrSlug/related')
  @ApiOperation({ summary: 'Related products for a product detail page' })
  @ApiParam({
    name: 'idOrSlug',
    description: 'Product UUID or slug',
    example: 'iphone-air-256gb-light-gold',
  })
  @ApiQuery({
    name: 'limit',
    required: false,
    description: `Max related products to return (default ${RELATED_DEFAULT_LIMIT}, max ${RELATED_MAX_LIMIT})`,
    example: RELATED_DEFAULT_LIMIT,
  })
  @ApiQuery({
    name: 'displayCurrency',
    required: false,
    description: 'ISO 4217 currency code to convert prices into (e.g. USD, EUR, NGN).',
    example: 'USD',
  })
  async getRelated(
    @Param('idOrSlug') idOrSlug: string,
    @Query('limit', new DefaultValuePipe(RELATED_DEFAULT_LIMIT), ParseIntPipe) limit: number,
    @Query('displayCurrency') displayCurrency?: string,
  ) {
    const capped = Math.min(RELATED_MAX_LIMIT, Math.max(1, limit));
    const results = await this.productsService.findRelated(idOrSlug, capped);

    if (!displayCurrency) return results;

    const target = displayCurrency.trim().toUpperCase();
    if (!isValidCurrencyCode(target)) {
      throw new BadRequestException(
        `Invalid displayCurrency "${displayCurrency}" — must be a 3-letter ISO 4217 code (e.g. USD, EUR, NGN)`,
      );
    }

    return Promise.all(
      results.map((r) => this.currencyService.convertProductResponse(r, target)),
    );
  }

  @Public()
  @Get(':idOrSlug')
  @ApiParam({
    name: 'idOrSlug',
    description:
      'Product UUID (e.g. for cart `productId`) or readable **slug** from `GET /products` responses (`slug` field).',
    example: 'iphone-air-256gb-light-gold',
  })
  @ApiQuery({
    name: 'displayCurrency',
    required: false,
    description:
      'ISO 4217 currency code to convert prices into (e.g. USD, EUR, NGN). Rates are cached hourly.',
    example: 'USD',
  })
  async getOne(
    @Param('idOrSlug') idOrSlug: string,
    @Query('displayCurrency') displayCurrency?: string,
  ) {
    const p = await this.productsService.findByIdOrSlug(idOrSlug);
    const response = this.productsService.toResponse(p);

    if (!displayCurrency) return response;

    const target = displayCurrency.trim().toUpperCase();
    if (!isValidCurrencyCode(target)) {
      throw new BadRequestException(
        `Invalid displayCurrency "${displayCurrency}" — must be a 3-letter ISO 4217 code (e.g. USD, EUR, NGN)`,
      );
    }

    return this.currencyService.convertProductResponse(response, target);
  }
}
