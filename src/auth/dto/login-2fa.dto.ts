import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { LocalCartItemDto } from '../../cart/dto/local-cart-item.dto';

const MAX_LOCAL_CART_LINES = 100;

export class Login2faDto {
  @ApiProperty({
    description:
      'Token from login when `requiresTwoFactor` is true (short-lived).',
  })
  @IsString()
  @MinLength(20)
  preAuthToken: string;

  @ApiProperty({
    description: '6–8 digit code from the authenticator app',
    example: '123456',
  })
  @IsString()
  @MinLength(6)
  @MaxLength(8)
  code: string;

  @ApiPropertyOptional({
    description:
      'Optional guest cart; merged after successful 2FA (same as login).',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_LOCAL_CART_LINES)
  @ValidateNested({ each: true })
  @Type(() => LocalCartItemDto)
  localCart?: LocalCartItemDto[];
}
