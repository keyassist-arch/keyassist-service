import { Type } from 'class-transformer';
import {
  IsObject,
  IsOptional,
  IsString,
  ValidateNested,
} from 'class-validator';

class ShippingAddressDto {
  @IsOptional()
  @IsString()
  fullName?: string;

  @IsString()
  line1: string;

  @IsOptional()
  @IsString()
  line2?: string;

  @IsString()
  city: string;

  @IsOptional()
  @IsString()
  state?: string;

  @IsString()
  country: string;

  @IsOptional()
  @IsString()
  postalCode?: string;

  @IsOptional()
  @IsString()
  phone?: string;
}

export class CreateOrderDto {
  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => ShippingAddressDto)
  shippingAddress?: ShippingAddressDto;
}
