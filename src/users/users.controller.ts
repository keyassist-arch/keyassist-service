import { Body, Controller, Get, Patch, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { SWAGGER_JWT_AUTH } from '../common/constants/swagger-auth';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { JwtPayload } from '../auth/interfaces/jwt-payload.interface';
import { UsersService } from './users.service';
import { UpdateProfileDto } from './dto/update-profile.dto';

@ApiTags('Me')
@ApiBearerAuth(SWAGGER_JWT_AUTH)
@Controller()
@UseGuards(JwtAuthGuard)
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get('me')
  async me(@CurrentUser() user: JwtPayload) {
    const full = await this.usersService.findById(user.sub);
    return this.usersService.toPublic(full);
  }

  @Patch('me')
  async updateMe(
    @CurrentUser() user: JwtPayload,
    @Body() dto: UpdateProfileDto,
  ) {
    const updated = await this.usersService.updateProfile(user.sub, dto);
    return this.usersService.toPublic(updated);
  }
}
