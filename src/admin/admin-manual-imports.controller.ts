import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { UserRole } from '../common/enums/role.enum';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { RequirePermission } from '../common/decorators/require-permission.decorator';
import { AdminPermission } from '../common/enums/admin-permission.enum';
import { SWAGGER_JWT_AUTH } from '../common/constants/swagger-auth';
import { AdminManualImportsService } from './admin-manual-imports.service';
import type { ManualImportFulfillmentStatus } from './admin-manual-imports.service';
import { AdminPlaceManualImportOrderDto } from './dto/admin-place-manual-import-order.dto';
import { AdminDismissManualImportDto } from './dto/admin-dismiss-manual-import.dto';

/**
 * Queue of customer-submitted manual product imports (auto-scrape failed, they
 * entered details by hand) awaiting admin to place an order on their behalf.
 */
@ApiTags('Admin – Manual Imports')
@ApiBearerAuth(SWAGGER_JWT_AUTH)
@Controller('admin/manual-imports')
@UseGuards(JwtAuthGuard, RolesGuard, PermissionsGuard)
@Roles(UserRole.ADMIN_SUPER, UserRole.ADMIN_STAFF)
export class AdminManualImportsController {
  constructor(private readonly service: AdminManualImportsService) {}

  @Get()
  @RequirePermission(AdminPermission.PRODUCTS)
  @ApiOperation({ summary: 'List manual-import requests by fulfillment status' })
  list(@Query('status') status: ManualImportFulfillmentStatus = 'pending') {
    return this.service.list(status);
  }

  @Post(':id/order')
  @RequirePermission(AdminPermission.PRODUCTS)
  @ApiOperation({
    summary: 'Place an order for the requesting customer',
    description:
      'Runs the same landed-cost quote engine used at checkout, then creates a PENDING order under the requesting customer\'s account — payable by them through the normal checkout/payment flow.',
  })
  placeOrder(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AdminPlaceManualImportOrderDto,
  ) {
    return this.service.placeOrder(id, dto);
  }

  @Post(':id/dismiss')
  @RequirePermission(AdminPermission.PRODUCTS)
  @ApiOperation({ summary: 'Dismiss a manual-import request without placing an order' })
  dismiss(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AdminDismissManualImportDto,
  ) {
    return this.service.dismiss(id, dto);
  }
}
