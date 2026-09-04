import { IsInt, IsObject, IsOptional, Max, Min } from 'class-validator';

export class UpdateCartItemDto {
  @IsInt()
  @Min(0)
  @Max(100)
  quantity: number;

  /** Update the variant selection (e.g. when user changes size in the cart). */
  @IsOptional()
  @IsObject()
  variantSelection?: Record<string, string>;
}
