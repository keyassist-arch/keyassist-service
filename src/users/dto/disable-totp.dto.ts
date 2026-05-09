import { ApiProperty } from '@nestjs/swagger';
import { IsString, MaxLength, MinLength } from 'class-validator';

export class DisableTotpDto {
  @ApiProperty()
  @IsString()
  @MinLength(1)
  password: string;

  @ApiProperty({
    description: 'Current 6–8 digit code from the authenticator app',
  })
  @IsString()
  @MinLength(6)
  @MaxLength(8)
  code: string;
}
