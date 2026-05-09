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
import { SWAGGER_JWT_AUTH } from '../common/constants/swagger-auth';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { JwtPayload } from '../auth/interfaces/jwt-payload.interface';
import { ReconciliationService } from './reconciliation.service';
import { CreatePriceDisputeDto } from './dto/create-price-dispute.dto';
import { ListMyIssuesDto } from './dto/list-my-issues.dto';
import { CreateUserIssueDto } from './dto/create-user-issue.dto';
import { CreateIssueDto } from './dto/create-issue.dto';

@ApiTags('Reconciliation')
@ApiBearerAuth(SWAGGER_JWT_AUTH)
@Controller('reconciliation')
@UseGuards(JwtAuthGuard)
export class ReconciliationUserController {
  constructor(private readonly reconciliationService: ReconciliationService) {}

  @Post('issues')
  @ApiOperation({
    summary: 'Submit a new issue/ticket to support',
    description:
      'Create a support ticket for refund requests, item issues, billing problems, etc.',
  })
  submitIssue(
    @CurrentUser() user: JwtPayload,
    @Body() dto: CreateUserIssueDto,
  ) {
    const createDto: CreateIssueDto = {
      ...dto,
      userId: user.sub,
    };
    return this.reconciliationService.createIssue(createDto);
  }

  @Post('price-disputes')
  @ApiOperation({
    summary:
      'Buyer requests price verification for an order and opens a dispute ticket',
  })
  requestPriceDispute(
    @CurrentUser() user: JwtPayload,
    @Body() dto: CreatePriceDisputeDto,
  ) {
    return this.reconciliationService.requestPriceVerification(user.sub, dto);
  }

  @Get('my-issues')
  @ApiOperation({ summary: 'Buyer lists their own dispute/issue tickets' })
  myIssues(@CurrentUser() user: JwtPayload, @Query() query: ListMyIssuesDto) {
    return this.reconciliationService.listMyIssues(user.sub, query);
  }

  @Get('my-issues/:id')
  @ApiOperation({ summary: 'Buyer fetches one of their issue tickets' })
  myIssue(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.reconciliationService.getMyIssue(user.sub, id);
  }
}
