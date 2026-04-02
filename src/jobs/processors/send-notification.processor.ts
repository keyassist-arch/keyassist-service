import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { Logger } from '@nestjs/common';
import { QUEUE_SEND_NOTIFICATION } from '../queue.constants';
import { NotificationsService } from '../../notifications/notifications.service';
import { maskEmail } from '../../common/utils/log-preview.util';

export type SendNotificationJob = {
  type: 'order_confirmation' | 'shipment_update';
  toEmail: string;
  subject: string;
  text: string;
  html?: string;
};

@Processor(QUEUE_SEND_NOTIFICATION)
export class SendNotificationProcessor extends WorkerHost {
  private readonly logger = new Logger(SendNotificationProcessor.name);

  constructor(private readonly notifications: NotificationsService) {
    super();
  }

  async process(job: Job<SendNotificationJob>): Promise<void> {
    this.logger.log(
      `[job:notify] step=send type=${job.data.type} to=${maskEmail(job.data.toEmail)} jobId=${job.id}`,
    );
    await this.notifications.sendEmail({
      to: job.data.toEmail,
      subject: job.data.subject,
      text: job.data.text,
      html: job.data.html,
    });
    this.logger.log(
      `[job:notify] step=sent type=${job.data.type} to=${maskEmail(job.data.toEmail)}`,
    );
  }
}
