import { Body, Controller, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from '../common/decorators/public.decorator';
import { LandedCostService } from './landed-cost.service';
import { LandedCostQuoteDto } from './dto/landed-cost-quote.dto';

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
      'international shipping (Kingz), Nigeria customs/duties, FX buffer, risk buffer, ' +
      'and service charge. Pass productId to derive price from a scraped product, or ' +
      'supply productPriceUsd + marketplace directly.',
  })
  quote(@Body() dto: LandedCostQuoteDto) {
    return this.landedCostService.quote(dto);
  }
}
