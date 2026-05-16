import {
  BadRequestException,
  Body,
  Controller,
  DefaultValuePipe,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';
import { Public } from '../common/decorators/public.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { UserRole } from '../common/enums/role.enum';
import { SWAGGER_JWT_AUTH } from '../common/constants/swagger-auth';
import { CurrencyService } from '../currency/currency.service';
import { CategoriesService } from './categories.service';
import { CreateCategoryDto } from './dto/create-category.dto';
import { UpdateCategoryDto } from './dto/update-category.dto';

const PRODUCTS_DEFAULT_LIMIT = 24;
const PRODUCTS_MAX_LIMIT = 100;

function isValidCurrencyCode(code: string): boolean {
  return /^[A-Z]{3}$/.test(code.trim().toUpperCase());
}

@ApiTags('Categories')
@Controller('categories')
export class CategoriesController {
  constructor(
    private readonly categoriesService: CategoriesService,
    private readonly currencyService: CurrencyService,
  ) {}

  // ─── Public read endpoints ───────────────────────────────────────────────────

  @Public()
  @Get()
  @ApiOperation({ summary: 'List all categories ordered by position, with product counts' })
  listAll() {
    return this.categoriesService.findAll();
  }

  @Public()
  @Get(':idOrSlug')
  @ApiOperation({ summary: 'Get a single category by UUID or slug' })
  @ApiParam({ name: 'idOrSlug', example: 'sneakers' })
  getOne(@Param('idOrSlug') idOrSlug: string) {
    return this.categoriesService.findOneResponse(idOrSlug);
  }

  @Public()
  @Get(':idOrSlug/products')
  @ApiOperation({ summary: 'Paginated products in a category' })
  @ApiParam({ name: 'idOrSlug', example: 'sneakers' })
  @ApiQuery({ name: 'limit', required: false, example: PRODUCTS_DEFAULT_LIMIT })
  @ApiQuery({ name: 'page', required: false, example: 1 })
  @ApiQuery({
    name: 'displayCurrency',
    required: false,
    description: 'ISO 4217 code to convert prices (e.g. USD, NGN, EUR)',
    example: 'USD',
  })
  async getProducts(
    @Param('idOrSlug') idOrSlug: string,
    @Query('limit', new DefaultValuePipe(PRODUCTS_DEFAULT_LIMIT), ParseIntPipe) limit: number,
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
    @Query('displayCurrency') displayCurrency?: string,
  ) {
    const cappedLimit = Math.min(PRODUCTS_MAX_LIMIT, Math.max(1, limit));
    const safePage = Math.max(1, page);

    const result = await this.categoriesService.findProductsInCategory(
      idOrSlug,
      cappedLimit,
      safePage,
    );

    if (!displayCurrency) return result;

    const target = displayCurrency.trim().toUpperCase();
    if (!isValidCurrencyCode(target)) {
      throw new BadRequestException(
        `Invalid displayCurrency "${displayCurrency}" — must be a 3-letter ISO 4217 code`,
      );
    }

    const converted = await Promise.all(
      result.results.map((r) => this.currencyService.convertProductResponse(r, target)),
    );
    return { ...result, results: converted };
  }

  // ─── Admin CRUD ──────────────────────────────────────────────────────────────

  @Post()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN_SUPER, UserRole.ADMIN_STAFF)
  @ApiBearerAuth(SWAGGER_JWT_AUTH)
  @ApiOperation({ summary: 'Create a category (admin)' })
  create(@Body() dto: CreateCategoryDto) {
    return this.categoriesService.create(dto);
  }

  @Patch(':id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN_SUPER, UserRole.ADMIN_STAFF)
  @ApiBearerAuth(SWAGGER_JWT_AUTH)
  @ApiOperation({ summary: 'Update a category (admin)' })
  @ApiParam({ name: 'id', description: 'Category UUID' })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateCategoryDto,
  ) {
    return this.categoriesService.update(id, dto);
  }

  @Delete(':id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN_SUPER, UserRole.ADMIN_STAFF)
  @ApiBearerAuth(SWAGGER_JWT_AUTH)
  @ApiOperation({ summary: 'Delete a category and unlink its products (admin)' })
  @ApiParam({ name: 'id', description: 'Category UUID' })
  remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.categoriesService.remove(id);
  }

  @Patch(':id/products/:productId')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN_SUPER, UserRole.ADMIN_STAFF)
  @ApiBearerAuth(SWAGGER_JWT_AUTH)
  @ApiOperation({ summary: 'Assign a product to this category (admin)' })
  @ApiParam({ name: 'id', description: 'Category UUID' })
  @ApiParam({ name: 'productId', description: 'Product UUID' })
  assignProduct(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('productId', ParseUUIDPipe) productId: string,
  ) {
    return this.categoriesService.assignProductCategory(productId, id);
  }

  @Delete(':id/products/:productId')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN_SUPER, UserRole.ADMIN_STAFF)
  @ApiBearerAuth(SWAGGER_JWT_AUTH)
  @ApiOperation({ summary: 'Remove a product from this category (admin)' })
  @ApiParam({ name: 'id', description: 'Category UUID' })
  @ApiParam({ name: 'productId', description: 'Product UUID' })
  unassignProduct(
    @Param('id', ParseUUIDPipe) _id: string,
    @Param('productId', ParseUUIDPipe) productId: string,
  ) {
    return this.categoriesService.assignProductCategory(productId, null);
  }
}
