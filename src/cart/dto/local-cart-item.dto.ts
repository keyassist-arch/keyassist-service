import { IsInt, IsObject, IsOptional, IsUUID, Max, Min } from 'class-validator';

/** One line from a guest / localStorage cart — same shape as `POST /cart/items`. */
export class LocalCartItemDto {
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
