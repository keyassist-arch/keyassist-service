import { Global, Module } from '@nestjs/common';
import { NotificationsService } from './notifications.service';
import { EmailTemplateService } from './email-templates.service';

@Global()
@Module({
  providers: [NotificationsService, EmailTemplateService],
  exports: [NotificationsService, EmailTemplateService],
})
export class NotificationsModule {}
