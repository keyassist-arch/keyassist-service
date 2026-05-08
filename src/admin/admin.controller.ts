import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { SWAGGER_JWT_AUTH } from '../common/constants/swagger-auth';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { UserRole } from '../common/enums/role.enum';
import { AdminService } from './admin.service';
import { AdminPatchOrderDto } from './dto/admin-patch-order.dto';
import { ScraperService } from '../scraper/scraper.service';
import { AdminScrapePreviewDto } from './dto/admin-scrape-preview.dto';
import { UpdateShippingRatesDto } from '../shipping/dto/update-shipping-rates.dto';

@ApiTags('Admin')
@ApiBearerAuth(SWAGGER_JWT_AUTH)
@Controller('admin')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN_SUPER, UserRole.ADMIN_STAFF)
export class AdminController {
  constructor(
    private readonly adminService: AdminService,
    private readonly scraperService: ScraperService,
  ) {}

  @Get('orders')
  orders() {
    return this.adminService.listOrders();
  }

  @Patch('orders/:id')
  patchOrder(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AdminPatchOrderDto,
  ) {
    return this.adminService.patchOrder(id, dto);
  }

  @Get('products')
  products() {
    return this.adminService.listProducts();
  }

  /**
   * Scrape.do–style “run scrape now” for debugging — does not persist import/product.
   * Product ingestion for users stays on `POST /products/import` + Bull queue.
   */
  @Get('shipping-rates')
  getShippingRates() {
    return this.adminService.getShippingRates();
  }

  @Patch('shipping-rates')
  updateShippingRates(@Body() dto: UpdateShippingRatesDto) {
    return this.adminService.updateShippingRates(dto);
  }

  @Post('scrape-preview')
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @ApiOperation({
    summary: 'Synchronous scrape preview (admin)',
    description:
      'Runs `ScraperService.scrape` in the HTTP request (Playwright). Can exceed 60s. ' +
      'Prefer `POST /products/import` for production ingestion (queued worker).',
  })
  async scrapePreview(@Body() dto: AdminScrapePreviewDto) {
    const detectedSource = this.scraperService.detectSource(dto.url);
    const scraped = await this.scraperService.scrape(dto.url, detectedSource);
    return {
      url: dto.url,
      detectedSource,
      scraped,
    };
  }
}
