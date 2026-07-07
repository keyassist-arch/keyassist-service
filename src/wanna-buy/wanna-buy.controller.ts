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
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { PhoneVerifiedGuard } from '../common/guards/phone-verified.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { RequirePermission } from '../common/decorators/require-permission.decorator';
import { AdminPermission } from '../common/enums/admin-permission.enum';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { SWAGGER_JWT_AUTH } from '../common/constants/swagger-auth';
import type { JwtPayload } from '../auth/interfaces/jwt-payload.interface';
import { UserRole } from '../common/enums/role.enum';
import { WannaBuyService } from './wanna-buy.service';
import { AddWannaBuyItemDto } from './dto/add-wanna-buy-item.dto';
import { AdminQuoteWannaBuyItemDto } from './dto/admin-quote-wanna-buy-item.dto';
import { AdminBatchStatusDto } from './dto/admin-batch-status.dto';

@ApiTags('Wanna Buy')
@ApiBearerAuth(SWAGGER_JWT_AUTH)
@Controller()
export class WannaBuyController {
  constructor(private readonly service: WannaBuyService) {}

  // ── User routes ─────────────────────────────────────────────────────────────

  @Post('wanna-buy')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Add a product to your Wanna Buy list' })
  add(@CurrentUser() user: JwtPayload, @Body() dto: AddWannaBuyItemDto) {
    return this.service.addItem(user.sub, dto);
  }

  @Get('wanna-buy')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'List your Wanna Buy items' })
  list(@CurrentUser() user: JwtPayload) {
    return this.service.listUserItems(user.sub);
  }

  @Post('wanna-buy/:id/pay')
  @UseGuards(JwtAuthGuard, PhoneVerifiedGuard)
  @ApiOperation({
    summary: 'Convert a quoted Wanna Buy item into a payable Order',
    description:
      'Creates an Order from the quoted item and returns it. ' +
      'The frontend then uses POST /payments/initialize with the returned orderId ' +
      '(or redirects to /checkout?resume=<orderId>).',
  })
  pay(@CurrentUser() user: JwtPayload, @Param('id', ParseUUIDPipe) id: string) {
    return this.service.createOrderForPayment(id, user.sub);
  }

  // ── Admin routes ─────────────────────────────────────────────────────────────

  @Get('admin/batches')
  @UseGuards(JwtAuthGuard, RolesGuard, PermissionsGuard)
  @Roles(UserRole.ADMIN_SUPER, UserRole.ADMIN_STAFF)
  @RequirePermission(AdminPermission.BATCHES)
  @ApiOperation({ summary: 'List all batches' })
  listBatches() {
    return this.service.listBatches();
  }

  @Post('admin/batches')
  @UseGuards(JwtAuthGuard, RolesGuard, PermissionsGuard)
  @Roles(UserRole.ADMIN_SUPER, UserRole.ADMIN_STAFF)
  @RequirePermission(AdminPermission.BATCHES)
  @ApiOperation({ summary: 'Create a new collecting batch' })
  createBatch(@Body() body: { label?: string }) {
    return this.service.createBatch(body.label);
  }

  @Patch('admin/batches/:id/status')
  @UseGuards(JwtAuthGuard, RolesGuard, PermissionsGuard)
  @Roles(UserRole.ADMIN_SUPER, UserRole.ADMIN_STAFF)
  @RequirePermission(AdminPermission.BATCHES)
  @ApiOperation({ summary: 'Advance batch lifecycle status' })
  advanceBatchStatus(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AdminBatchStatusDto,
  ) {
    return this.service.advanceBatchStatus(id, dto.status);
  }

  @Get('admin/batches/:id/items')
  @UseGuards(JwtAuthGuard, RolesGuard, PermissionsGuard)
  @Roles(UserRole.ADMIN_SUPER, UserRole.ADMIN_STAFF)
  @RequirePermission(AdminPermission.BATCHES)
  @ApiOperation({ summary: 'List items in a batch' })
  getBatchItems(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.getBatchItems(id);
  }

  @Patch('admin/wanna-buy/:id/quote')
  @UseGuards(JwtAuthGuard, RolesGuard, PermissionsGuard)
  @Roles(UserRole.ADMIN_SUPER, UserRole.ADMIN_STAFF)
  @RequirePermission(AdminPermission.BATCHES)
  @ApiOperation({
    summary: 'Edit price / enter tax and optionally notify user',
  })
  saveQuote(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AdminQuoteWannaBuyItemDto,
  ) {
    return this.service.saveQuote(id, dto);
  }
}
