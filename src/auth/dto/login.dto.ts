import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsEmail,
  IsOptional,
  IsString,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { LocalCartItemDto } from '../../cart/dto/local-cart-item.dto';

const MAX_LOCAL_CART_LINES = 100;

export class LoginDto {
  @IsEmail()
  email: string;

  @IsString()
  @MinLength(1)
  password: string;

  /**
   * Optional guest cart from localStorage; merged into the user's DB cart after successful login
   * (same behavior as `POST /cart/sync`).
   */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_LOCAL_CART_LINES)
  @ValidateNested({ each: true })
  @Type(() => LocalCartItemDto)
  localCart?: LocalCartItemDto[];
}
