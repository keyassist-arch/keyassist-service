import { IsInt, IsNumber, IsOptional, Min } from 'class-validator';

export class UpdateShippingRatesDto {
  @IsOptional()
  @IsNumber()
  @Min(0)
  airRateLagosPerLb?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  airRateOutsideLagosPerLb?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  dimDivisor?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  airMinimumLagos?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  airMinimumOutsideLagos?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  minWeightLbs?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  bulkCommercialSurcharge?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  tvClearingFee?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  oceanSmallBoxRate?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  cargoInsuranceRateLagos?: number;
}
