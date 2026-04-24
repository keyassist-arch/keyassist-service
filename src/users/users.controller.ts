import {
  Body,
  Controller,
  Get,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { SWAGGER_JWT_AUTH } from '../common/constants/swagger-auth';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { JwtPayload } from '../auth/interfaces/jwt-payload.interface';
import { UsersService } from './users.service';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { ConfirmTotpDto } from './dto/confirm-totp.dto';
import { DisableTotpDto } from './dto/disable-totp.dto';

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

  @Get('me/2fa')
  @ApiOperation({ summary: 'Two-factor authentication status' })
  async twoFactorStatus(@CurrentUser() user: JwtPayload) {
    const u = await this.usersService.findById(user.sub);
    return this.usersService.twoFactorSummary(u);
  }

  @Post('me/2fa/setup')
  @ApiOperation({ summary: 'Start TOTP setup (scan QR, then call enable)' })
  async beginTwoFactor(@CurrentUser() user: JwtPayload) {
    return this.usersService.beginTotpSetup(user.sub);
  }

  @Post('me/2fa/enable')
  @ApiOperation({ summary: 'Enable 2FA after scanning QR / entering secret' })
  async enableTwoFactor(
    @CurrentUser() user: JwtPayload,
    @Body() dto: ConfirmTotpDto,
  ) {
    await this.usersService.confirmTotpSetup(user.sub, dto.code);
    return { twoFactor: { enabled: true, setupPending: false } };
  }

  @Post('me/2fa/setup/cancel')
  @ApiOperation({ summary: 'Cancel a pending 2FA enrollment' })
  async cancelTwoFactorSetup(@CurrentUser() user: JwtPayload) {
    await this.usersService.cancelTotpSetup(user.sub);
    return { cancelled: true };
  }

  @Post('me/2fa/disable')
  @ApiOperation({ summary: 'Turn off 2FA (password + app code; signs out other sessions)' })
  async disableTwoFactor(
    @CurrentUser() user: JwtPayload,
    @Body() dto: DisableTotpDto,
  ) {
    await this.usersService.disableTotp(user.sub, dto.password, dto.code);
    return { twoFactor: { enabled: false, setupPending: false } };
  }
}
