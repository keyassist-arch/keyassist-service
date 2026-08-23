import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from '../common/decorators/public.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { SWAGGER_JWT_AUTH } from '../common/constants/swagger-auth';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { JwtPayload } from '../auth/interfaces/jwt-payload.interface';
import { LandedCostService } from './landed-cost.service';
import { LandedCostQuoteDto } from './dto/landed-cost-quote.dto';
import { LandedCostCartQuoteDto } from './dto/landed-cost-cart-quote.dto';

@ApiTags('Landed Cost')
@Controller('landed-cost')
export class LandedCostController {
  constructor(private readonly landedCostService: LandedCostService) {}

  @Public()
  @Post('quote')
  @ApiOperation({
    summary: 'Calculate full landed cost for a product',
    description:
      'Returns an itemised price breakdown including marketplace tax, domestic handling, ' +
      'international shipping (Kingz, customs/clearing included), FX buffer, risk buffer, ' +
      'and service charge. Pass productId to derive price from a scraped product, or ' +
      'supply productPriceUsd + marketplace directly.',
  })
  quote(@Body() dto: LandedCostQuoteDto) {
    return this.landedCostService.quote(dto);
  }

  @ApiBearerAuth(SWAGGER_JWT_AUTH)
  @UseGuards(JwtAuthGuard)
  @Post('quote-cart')
  @ApiOperation({
    summary: "Calculate full landed cost for the current user's entire cart",
    description:
      'Same breakdown shape as POST /landed-cost/quote, but aggregates every cart line ' +
      'into a single Kingz shipment — matching exactly what order creation charges, unlike ' +
      'quoting a single line and ignoring the rest of the cart.',
  })
  quoteCart(
    @CurrentUser() user: JwtPayload,
    @Body() dto: LandedCostCartQuoteDto,
  ) {
    return this.landedCostService.quoteForUserCart(user.sub, dto);
  }
}
