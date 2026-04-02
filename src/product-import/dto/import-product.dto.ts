import { IsUrl, MaxLength } from 'class-validator';

export class ImportProductDto {
  @IsUrl({ require_protocol: true }, { message: 'url must be a valid URL' })
  @MaxLength(2048)
  url: string;
}
