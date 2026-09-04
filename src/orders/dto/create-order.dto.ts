import { Type } from 'class-transformer';
import { IsObject, IsOptional, ValidateNested } from 'class-validator';
import { ShippingAddressDto } from './shipping-address.dto';
import { LandedCostInputDto } from './landed-cost-input.dto';

export class CreateOrderDto {
  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => ShippingAddressDto)
  shippingAddress?: ShippingAddressDto;

  @IsObject()
  @ValidateNested()
  @Type(() => LandedCostInputDto)
  landedCost: LandedCostInputDto;
}
