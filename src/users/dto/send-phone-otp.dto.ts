import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength } from 'class-validator';

export class SendPhoneOtpDto {
  @ApiPropertyOptional({
    description:
      'Phone number to verify, in international format (e.g. +2348012345678). ' +
      'Omit to resend a code to the phone already on file.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(32)
  phone?: string;
}
