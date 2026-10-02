import {
  BadRequestException,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { UsersService } from '../users/users.service';
import { AuthService } from '../auth/auth.service';
import { NotificationsService } from '../notifications/notifications.service';
import { EmailTemplateService } from '../notifications/email-templates.service';
import { User } from '../users/entities/user.entity';
import { isAdminRole } from '../common/enums/role.enum';
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
      role: dto.role,
    });
    const inviteEmailSent = await this.sendInvite(user);
    return { ...this.usersService.toAdminUserResponse(user), inviteEmailSent };
  }

  /** Re-issues the set-password link, e.g. after it expired or bounced. */
  async resendInvite(id: string) {
    const user = await this.usersService.findById(id);
    if (!isAdminRole(user.role)) {
      throw new BadRequestException('Not an admin account');
    }
    if (user.adminDisabledAt) {
      throw new BadRequestException('Re-enable this account before resending');
    }
    const inviteEmailSent = await this.sendInvite(user);
    if (!inviteEmailSent) {
      throw new ServiceUnavailableException('Failed to send invite email');
    }
    return { inviteEmailSent };
  }

  async patch(actorId: string, id: string, dto: PatchAdminUserDto) {
    const user = await this.usersService.patchAdminUser(actorId, id, dto);
    return this.usersService.toAdminUserResponse(user);
  }

  private async sendInvite(user: User): Promise<boolean> {
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
      return true;
    } catch (err) {
      this.logger.error(
        `[admin-users] step=invite_email_failed userId=${user.id}`,
        err instanceof Error ? err.stack : err,
      );
      return false;
    }
  }
}
