import { IsInt, IsObject, IsOptional, IsUUID, Max, Min } from 'class-validator';

export class AddCartItemDto {
  @IsUUID()
  productId: string;

  @IsInt()
  @Min(1)
  @Max(100)
  quantity: number;

  @IsOptional()
  @IsObject()
  variantSelection?: Record<string, string>;
}
