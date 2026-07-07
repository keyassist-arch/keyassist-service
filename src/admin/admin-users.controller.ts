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
    summary: 'Invite a new ADMIN_STAFF user with specific screen permissions',
    description:
      'Creates the account and emails a set-password link. Only mints ADMIN_STAFF — ' +
      'promoting to ADMIN_SUPER stays a manual/DB action.',
  })
  create(@Body() dto: CreateAdminUserDto) {
    return this.adminUsersService.create(dto);
  }

  @Patch(':id')
  @ApiOperation({
    summary: 'Update an ADMIN_STAFF user\'s permissions and/or disabled state',
  })
  patch(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: PatchAdminUserDto,
  ) {
    return this.adminUsersService.patch(id, dto);
  }
}
