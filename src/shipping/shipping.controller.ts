import { Body, Controller, Post } from '@nestjs/common';
import { ShippingService } from './shipping.service';
import { ShippingQuoteDto } from './dto/shipping-quote.dto';

@Controller('shipping')
export class ShippingController {
  constructor(private readonly shippingService: ShippingService) {}

  @Post('quote')
  quote(@Body() dto: ShippingQuoteDto) {
    const result = this.shippingService.calculate(dto);
    return {
      carrier: 'Kingz International Logistics',
      service: dto.service,
      destination: dto.destination,
      ...result,
    };
  }
}
