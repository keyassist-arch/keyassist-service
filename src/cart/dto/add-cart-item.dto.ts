import { IsInt, IsObject, IsOptional, IsUUID, Min } from 'class-validator';

export class AddCartItemDto {
  @IsUUID()
  productId: string;

  @IsInt()
  @Min(1)
  quantity: number;

  @IsOptional()
  @IsObject()
  variantSelection?: Record<string, string>;
}
