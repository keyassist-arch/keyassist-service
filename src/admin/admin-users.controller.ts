import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { JwtPayload } from '../auth/interfaces/jwt-payload.interface';
import { UserRole } from '../common/enums/role.enum';
import { SWAGGER_JWT_AUTH } from '../common/constants/swagger-auth';
import { AdminUsersService } from './admin-users.service';
import { CreateAdminUserDto } from './dto/create-admin-user.dto';
import { PatchAdminUserDto } from './dto/patch-admin-user.dto';

/**
 * Team management — inviting/editing admin accounts. Super-admin only:
 * unlike the rest of the admin surface, this isn't gated by a grantable
 * permission, since it controls who gets grantable permissions.
 */
@ApiTags('Admin – Team')
@ApiBearerAuth(SWAGGER_JWT_AUTH)
@Controller('admin/users')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN_SUPER)
export class AdminUsersController {
  constructor(private readonly adminUsersService: AdminUsersService) {}

  @Get()
  @ApiOperation({ summary: 'List admin users (ADMIN_SUPER + ADMIN_STAFF)' })
  list() {
    return this.adminUsersService.list();
  }

  @Post()
  @ApiOperation({
    summary: 'Invite a new admin (ADMIN_STAFF by default, or ADMIN_SUPER)',
    description:
      'Creates the account and emails a set-password link. `inviteEmailSent` ' +
      'is false if the email failed — use resend-invite to retry.',
  })
  create(@Body() dto: CreateAdminUserDto) {
    return this.adminUsersService.create(dto);
  }

  @Patch(':id')
  @ApiOperation({
    summary:
      "Change an admin's role, or a staff admin's permissions/disabled state",
    description:
      "Role changes take effect on the user's next token refresh. You cannot " +
      'change your own role or demote the last active ADMIN_SUPER.',
  })
  patch(
    @CurrentUser() actor: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: PatchAdminUserDto,
  ) {
    return this.adminUsersService.patch(actor.sub, id, dto);
  }

  @Post(':id/resend-invite')
  @ApiOperation({ summary: 'Email a fresh set-password link to an admin' })
  resendInvite(@Param('id', ParseUUIDPipe) id: string) {
    return this.adminUsersService.resendInvite(id);
  }
}
