import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { UsersService } from '../users/users.service';
import { AuthService } from '../auth/auth.service';
import { NotificationsService } from '../notifications/notifications.service';
import { EmailTemplateService } from '../notifications/email-templates.service';
import { resolveFrontendBaseUrl } from '../common/utils/frontend-url.util';
import { CreateAdminUserDto } from './dto/create-admin-user.dto';
import { PatchAdminUserDto } from './dto/patch-admin-user.dto';

@Injectable()
export class AdminUsersService {
  private readonly logger = new Logger(AdminUsersService.name);

  constructor(
    private readonly usersService: UsersService,
    private readonly authService: AuthService,
    private readonly notifications: NotificationsService,
    private readonly emailTemplates: EmailTemplateService,
    private readonly config: ConfigService,
  ) {}

  async list() {
    const users = await this.usersService.listAdminUsers();
    return users.map((u) => this.usersService.toAdminUserResponse(u));
  }

  async create(dto: CreateAdminUserDto) {
    const user = await this.usersService.createAdminUser({
      email: dto.email,
      firstName: dto.firstName,
      lastName: dto.lastName,
      permissions: dto.permissions,
    });

    const { token, ttlLabel } = await this.authService.issueAdminInviteToken(
      user.id,
    );
    const setPasswordUrl = `${resolveFrontendBaseUrl(this.config)}/reset-password?token=${encodeURIComponent(token)}`;
    const tpl = this.emailTemplates.adminInvite({
      setPasswordUrl,
      ttlLabel,
      displayName: user.firstName,
    });
    try {
      await this.notifications.sendEmail({
        to: user.email,
        subject: tpl.subject,
        text: tpl.text,
        html: tpl.html,
      });
    } catch (err) {
      this.logger.error(
        `[admin-users] step=invite_email_failed userId=${user.id}`,
        err instanceof Error ? err.stack : err,
      );
    }

    return this.usersService.toAdminUserResponse(user);
  }

  async patch(id: string, dto: PatchAdminUserDto) {
    const user = await this.usersService.patchAdminUser(id, dto);
    return this.usersService.toAdminUserResponse(user);
  }
}
