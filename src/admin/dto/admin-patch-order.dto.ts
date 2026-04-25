import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';
import { OrderStatus } from '../../common/enums/order-status.enum';

export class AdminPatchOrderDto {
  @IsOptional()
  @IsEnum(OrderStatus)
  status?: OrderStatus;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  supplierOrderId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  trackingNumber?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  carrier?: string;

  /** When carrier + tracking provided, append a tracking event row with this status label. */
  @IsOptional()
  @IsString()
  @MaxLength(64)
  trackingStatus?: string;

  /** Optional customer-visible note on the tracking event (e.g. "Arrived at local hub"). */
  @IsOptional()
  @IsString()
  @MaxLength(512)
  trackingMessage?: string;
}
