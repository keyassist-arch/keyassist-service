import { IsEnum, IsOptional, IsString, IsUUID } from 'class-validator';
import { OrderStatus } from '../../common/enums/order-status.enum';

export class AdminPatchOrderDto {
  @IsOptional()
  @IsEnum(OrderStatus)
  status?: OrderStatus;

  @IsOptional()
  @IsString()
  supplierOrderId?: string;

  @IsOptional()
  @IsString()
  trackingNumber?: string;

  @IsOptional()
  @IsString()
  carrier?: string;

  /** When carrier + tracking provided, append tracking row with this status */
  @IsOptional()
  @IsString()
  trackingStatus?: string;
}
