import {
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { SWAGGER_JWT_AUTH } from '../common/constants/swagger-auth';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { JwtPayload } from '../auth/interfaces/jwt-payload.interface';
import { SavesService } from './saves.service';

@ApiTags('Saves')
@ApiBearerAuth(SWAGGER_JWT_AUTH)
@Controller('saves')
@UseGuards(JwtAuthGuard)
export class SavesController {
  constructor(private readonly savesService: SavesService) {}

  @Get()
  @ApiOperation({ summary: 'List all saved products for the current user' })
  list(@CurrentUser() user: JwtPayload) {
    return this.savesService.list(user.sub);
  }

  @Post(':productId')
  @ApiOperation({ summary: 'Save a product' })
  save(
    @CurrentUser() user: JwtPayload,
    @Param('productId', ParseUUIDPipe) productId: string,
  ) {
    return this.savesService.save(user.sub, productId);
  }

  @Delete(':productId')
  @ApiOperation({ summary: 'Unsave a product' })
  remove(
    @CurrentUser() user: JwtPayload,
    @Param('productId', ParseUUIDPipe) productId: string,
  ) {
    return this.savesService.remove(user.sub, productId);
  }

  @Get(':productId/status')
  @ApiOperation({ summary: 'Check if a product is saved by the current user' })
  async status(
    @CurrentUser() user: JwtPayload,
    @Param('productId', ParseUUIDPipe) productId: string,
  ) {
    const saved = await this.savesService.isSaved(user.sub, productId);
    return { saved };
  }
}
