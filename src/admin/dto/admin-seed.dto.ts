import { IsString } from 'class-validator';

export class AdminSeedDto {
  @IsString()
  setupKey: string;
}
