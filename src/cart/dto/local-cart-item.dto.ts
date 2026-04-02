import { IsInt, IsObject, IsOptional, IsUUID, Min } from 'class-validator';

/** One line from a guest / localStorage cart — same shape as `POST /cart/items`. */
export class LocalCartItemDto {
  @IsUUID()
  productId: string;

  @IsInt()
  @Min(1)
  quantity: number;

  @IsOptional()
  @IsObject()
  variantSelection?: Record<string, string>;
}
