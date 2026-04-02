import { ApiProperty } from '@nestjs/swagger';
import { IsUrl } from 'class-validator';

export class AdminScrapePreviewDto {
  @ApiProperty({
    example: 'https://www.jumia.com.ng/example-product.html',
    description:
      'Product page URL. Runs a synchronous Playwright scrape (30–90s+); use sparingly.',
  })
  @IsUrl({ require_protocol: true })
  url: string;
}
