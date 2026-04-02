import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, ValidateNested } from 'class-validator';
import { LocalCartItemDto } from './local-cart-item.dto';

const MAX_LOCAL_LINES = 100;

export class SyncLocalCartDto {
  @IsArray()
  @ArrayMaxSize(MAX_LOCAL_LINES)
  @ValidateNested({ each: true })
  @Type(() => LocalCartItemDto)
  items: LocalCartItemDto[];
}
