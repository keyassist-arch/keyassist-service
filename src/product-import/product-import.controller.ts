import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { Public } from '../common/decorators/public.decorator';
import { ProductImportService } from './product-import.service';
import { ImportProductDto } from './dto/import-product.dto';

@ApiTags('Products')
@Controller('products')
export class ProductImportController {
  constructor(private readonly productImportService: ProductImportService) {}

  @Public()
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  @Post('import')
  @ApiOperation({
    summary: 'Queue product import from URL',
    description:
      'Async import via background worker + browser scrape. When `status` is `queued` or `processing`, use `importId` and poll GET import status **or** subscribe on Socket.IO (`import.subscribe` → `import.updated`) for the same payload as this poll without waiting on an interval. Pending responses include `userMessage`, `phase`, `pollAfterMs`, and `typicalWaitSeconds` for UI.',
  })
  async import(@Body() dto: ImportProductDto) {
    return this.productImportService.importByUrl(dto.url);
  }

  @Public()
  @Get('import/:importId')
  @ApiOperation({
    summary: 'Poll import status',
    description:
      'Poll every `pollAfterMs` while `status` is QUEUED or PROCESSING. Same JSON shape as Socket.IO event `import.updated` after `import.subscribe` with this id.',
  })
  async importStatus(@Param('importId', ParseUUIDPipe) importId: string) {
    return this.productImportService.getImportStatus(importId);
  }
}
