import { ApiProperty } from '@nestjs/swagger';
import { IsString, MaxLength, MinLength } from 'class-validator';

export class ConfirmTotpDto {
  @ApiProperty({ description: 'Code from the authenticator app' })
  @IsString()
  @MinLength(6)
  @MaxLength(8)
  code: string;
}
