import {
  Controller,
  DefaultValuePipe,
  Get,
  Param,
  ParseIntPipe,
  Query,
} from '@nestjs/common';
import { ApiParam, ApiQuery, ApiTags } from '@nestjs/swagger';
import { Public } from '../common/decorators/public.decorator';
import { ProductsService } from './products.service';

const RECENT_PRODUCTS_DEFAULT = 24;
const RECENT_PRODUCTS_MAX = 100;

@ApiTags('Products')
@Controller('products')
export class ProductsController {
  constructor(private readonly productsService: ProductsService) {}

  /** Recent products for storefront home / discovery — no auth. Full admin list: `GET /admin/products`. */
  @Public()
  @Get()
  @ApiQuery({
    name: 'limit',
    required: false,
    description: `Max products to return (default ${RECENT_PRODUCTS_DEFAULT}, max ${RECENT_PRODUCTS_MAX})`,
    example: RECENT_PRODUCTS_DEFAULT,
  })
  async listRecent(
    @Query('limit', new DefaultValuePipe(RECENT_PRODUCTS_DEFAULT), ParseIntPipe)
    limit: number,
  ) {
    const capped = Math.min(RECENT_PRODUCTS_MAX, Math.max(1, limit));
    const list = await this.productsService.findRecentForPublic(capped);
    return list.map((p) => this.productsService.toResponse(p));
  }

  @Public()
  @Get(':idOrSlug')
  @ApiParam({
    name: 'idOrSlug',
    description:
      'Product UUID (e.g. for cart `productId`) or readable **slug** from `GET /products` responses (`slug` field).',
    example: 'iphone-air-256gb-light-gold',
  })
  async getOne(@Param('idOrSlug') idOrSlug: string) {
    const p = await this.productsService.findByIdOrSlug(idOrSlug);
    return this.productsService.toResponse(p);
  }
}
