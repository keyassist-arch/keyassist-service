import { ArrayMinSize, IsArray, IsUUID } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class PayWannaBuyItemsDto {
  @ApiProperty({ type: [String], description: 'One or more quoted WannaBuyItem ids to pay for in a single order' })
  @IsArray()
  @ArrayMinSize(1)
  @IsUUID('4', { each: true })
  itemIds: string[];
}
