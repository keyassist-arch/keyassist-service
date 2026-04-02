import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsOptional,
  IsString,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { LocalCartItemDto } from '../../cart/dto/local-cart-item.dto';

const MAX_LOCAL_CART_LINES = 100;

export class VerifyEmailDto {
  @IsString()
  @MinLength(10)
  token: string;

  /** Optional guest cart; merged after email is verified (same as register). */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_LOCAL_CART_LINES)
  @ValidateNested({ each: true })
  @Type(() => LocalCartItemDto)
  localCart?: LocalCartItemDto[];
}
