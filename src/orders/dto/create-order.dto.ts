import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  Min,
  ValidateNested,
} from 'class-validator';
import type { ShippingDestination, ShippingService } from '../../shipping/utils/kingz-rates';

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

class ShippingInputDto {
  @IsNumber()
  @Min(0.1)
  weight: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  length?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  width?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  height?: number;

  @IsEnum(['lagos', 'outside_lagos'] as const)
  destination: ShippingDestination;

  @IsEnum(['air', 'ocean_small'] as const)
  service: ShippingService;

  @IsOptional()
  @IsBoolean()
  bulkCommercial?: boolean;

  @IsOptional()
  @IsBoolean()
  isTV?: boolean;
}

export class CreateOrderDto {
  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => ShippingAddressDto)
  shippingAddress?: ShippingAddressDto;

  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => ShippingInputDto)
  shipping?: ShippingInputDto;
}
