import { Type } from 'class-transformer';
import { IsObject, IsOptional, ValidateNested } from 'class-validator';
import { ShippingAddressDto } from '../../orders/dto/shipping-address.dto';
import { LandedCostInputDto } from '../../orders/dto/landed-cost-input.dto';

export class AdminPlaceManualImportOrderDto {
  /** Falls back to the customer's saved default shipping address if omitted. */
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
