import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Request,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { SWAGGER_JWT_AUTH } from '../common/constants/swagger-auth';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { UserRole } from '../common/enums/role.enum';
import { ReconciliationService } from './reconciliation.service';
import { CreateRefundDto } from './dto/create-refund.dto';
import { CreateIssueDto } from './dto/create-issue.dto';
import { PatchIssueDto } from './dto/patch-issue.dto';
import { ListIssuesDto } from './dto/list-issues.dto';

@ApiTags('Admin – Reconciliation')
@ApiBearerAuth(SWAGGER_JWT_AUTH)
@Controller('admin/reconciliation')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN_SUPER, UserRole.ADMIN_STAFF)
export class ReconciliationController {
  constructor(private readonly reconciliationService: ReconciliationService) {}

  // --------------------------------------------------------------------------
  // Refunds
  // --------------------------------------------------------------------------

  @Post('refunds')
  @ApiOperation({ summary: 'Issue a refund for an order (Stripe / Paystack / PayPal / manual)' })
  issueRefund(@Body() dto: CreateRefundDto, @Request() req: { user: { sub: string } }) {
    return this.reconciliationService.issueRefund(dto, req.user.sub);
  }

  @Get('refunds')
  @ApiOperation({ summary: 'List all refunds, optionally filtered by orderId' })
  @ApiQuery({ name: 'orderId', required: false })
  listRefunds(@Query('orderId') orderId?: string) {
    return this.reconciliationService.listRefunds(orderId);
  }

  @Get('refunds/:id')
  @ApiOperation({ summary: 'Get a single refund record' })
  getRefund(@Param('id', ParseUUIDPipe) id: string) {
    return this.reconciliationService.getRefund(id);
  }

  // --------------------------------------------------------------------------
  // Customer Issues
  // --------------------------------------------------------------------------

  @Post('issues')
  @ApiOperation({ summary: 'Open a customer issue (dispute / complaint / request)' })
  createIssue(@Body() dto: CreateIssueDto) {
    return this.reconciliationService.createIssue(dto);
  }

  @Get('issues')
  @ApiOperation({ summary: 'List customer issues with optional filters' })
  listIssues(@Query() query: ListIssuesDto) {
    return this.reconciliationService.listIssues(query);
  }

  @Get('issues/:id')
  @ApiOperation({ summary: 'Get a single customer issue with related order and user' })
  getIssue(@Param('id', ParseUUIDPipe) id: string) {
    return this.reconciliationService.getIssue(id);
  }

  @Patch('issues/:id')
  @ApiOperation({ summary: 'Update a customer issue (status, assignment, resolution note)' })
  patchIssue(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: PatchIssueDto,
  ) {
    return this.reconciliationService.patchIssue(id, dto);
  }

  @Post('issues/:id/resolve-with-refund')
  @ApiOperation({
    summary: 'Resolve a customer issue and issue a refund in one operation',
  })
  resolveIssueWithRefund(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreateRefundDto,
    @Request() req: { user: { sub: string } },
  ) {
    return this.reconciliationService.resolveIssueWithRefund(id, dto, req.user.sub);
  }
}
