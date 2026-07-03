import { ApiProperty } from '@nestjs/swagger';
import { IsString, MinLength, MaxLength } from 'class-validator';

export class VerifyPhoneOtpDto {
  @ApiProperty({ description: 'The 6-digit code sent via WhatsApp' })
  @IsString()
  @MinLength(6)
  @MaxLength(6)
  code: string;
}
