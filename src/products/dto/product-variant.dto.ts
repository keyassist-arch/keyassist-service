import { ApiProperty } from '@nestjs/swagger';
import { ArrayMinSize, IsArray, IsString, MaxLength } from 'class-validator';

export class ProductVariantDto {
  @ApiProperty({ example: 'Size' })
  @IsString()
  @MaxLength(100)
  name: string;

  @ApiProperty({ example: ['S', 'M', 'L'], type: [String] })
  @IsArray()
  @ArrayMinSize(1)
  @IsString({ each: true })
  options: string[];
}
