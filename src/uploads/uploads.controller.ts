import { Controller, Get, Param, Res } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import type { Response } from 'express';
import { Public } from '../common/decorators/public.decorator';
import { UploadsService } from './uploads.service';

/** Public read proxy for object-storage keys — Railway buckets have no public bucket URL. */
@ApiExcludeController()
@Controller('uploads')
export class UploadsController {
  constructor(private readonly uploadsService: UploadsService) {}

  @Public()
  @Get(':key(*)')
  async getObject(@Param('key') key: string, @Res() res: Response) {
    const { body, contentType } = await this.uploadsService.getObject(key);
    res.setHeader('Content-Type', contentType);
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    body.pipe(res);
  }
}
