import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { ApiBearerAuth, ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { Public } from '../common/decorators/public.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { SWAGGER_JWT_AUTH } from '../common/constants/swagger-auth';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { UserRole } from '../common/enums/role.enum';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { RequirePermission } from '../common/decorators/require-permission.decorator';
import { AdminPermission } from '../common/enums/admin-permission.enum';
import { AdminService } from './admin.service';
import { AdminPatchOrderDto } from './dto/admin-patch-order.dto';
import { AdminSeedDto } from './dto/admin-seed.dto';
import { ScraperService } from '../scraper/scraper.service';
import { AdminScrapePreviewDto } from './dto/admin-scrape-preview.dto';
import { UpdateShippingRatesDto } from '../shipping/dto/update-shipping-rates.dto';
import { AdminCreateProductDto } from '../products/dto/admin-create-product.dto';
import { AdminUpdateProductDto } from '../products/dto/admin-update-product.dto';

@ApiTags('Admin')
@ApiBearerAuth(SWAGGER_JWT_AUTH)
@Controller('admin')
@UseGuards(JwtAuthGuard, RolesGuard, PermissionsGuard)
@Roles(UserRole.ADMIN_SUPER, UserRole.ADMIN_STAFF)
export class AdminController {
  constructor(
    private readonly adminService: AdminService,
    private readonly scraperService: ScraperService,
  ) {}

  @Get('orders')
  @RequirePermission(AdminPermission.ORDERS)
  orders() {
    return this.adminService.listOrders();
  }

  @Patch('orders/:id')
  @RequirePermission(AdminPermission.ORDERS)
  patchOrder(
    @Param('id') id: string,
    @Body() dto: AdminPatchOrderDto,
  ) {
    return this.adminService.patchOrder(id, dto);
  }

  @Get('products')
  @RequirePermission(AdminPermission.PRODUCTS)
  products() {
    return this.adminService.listProducts();
  }

  @Post('products')
  @RequirePermission(AdminPermission.PRODUCTS)
  @ApiOperation({ summary: 'Create a product by hand (admin panel, no scrape)' })
  createProduct(@Body() dto: AdminCreateProductDto) {
    return this.adminService.createProduct(dto);
  }

  @Patch('products/:id')
  @RequirePermission(AdminPermission.PRODUCTS)
  @ApiOperation({ summary: 'Update a product (admin panel)' })
  updateProduct(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AdminUpdateProductDto,
  ) {
    return this.adminService.updateProduct(id, dto);
  }

  @Delete('products/:id')
  @RequirePermission(AdminPermission.PRODUCTS)
  deleteProduct(@Param('id', ParseUUIDPipe) id: string) {
    return this.adminService.deleteProduct(id);
  }

  @Post('uploads')
  @RequirePermission(AdminPermission.PRODUCTS)
  @ApiOperation({ summary: 'Upload a product image to object storage' })
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: 8 * 1024 * 1024 },
    }),
  )
  uploadProductImage(@UploadedFile() file?: Express.Multer.File) {
    if (!file) {
      throw new BadRequestException('No file uploaded — expected field "file"');
    }
    return this.adminService.uploadProductImage(file);
  }

  /**
   * Scrape.do–style “run scrape now” for debugging — does not persist import/product.
   * Product ingestion for users stays on `POST /products/import` + Bull queue.
   */
  @Get('shipping-rates')
  @RequirePermission(AdminPermission.SHIPPING_RATES)
  getShippingRates() {
    return this.adminService.getShippingRates();
  }

  @Patch('shipping-rates')
  @RequirePermission(AdminPermission.SHIPPING_RATES)
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
