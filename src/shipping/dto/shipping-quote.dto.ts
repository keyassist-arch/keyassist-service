import { IsBoolean, IsEnum, IsNumber, IsOptional, Min } from 'class-validator';
import type {
  ShippingDestination,
  ShippingService,
} from '../utils/kingz-rates';

export class ShippingQuoteDto {
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

  @IsOptional()
  @IsNumber()
  @Min(0)
  declaredValueUsd?: number;

  @IsOptional()
  @IsBoolean()
  insurance?: boolean;
}
