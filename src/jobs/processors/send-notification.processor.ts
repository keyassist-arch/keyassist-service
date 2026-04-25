import {
  OnWorkerEvent,
  Processor,
  WorkerHost,
} from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { Logger } from '@nestjs/common';
import { QUEUE_SEND_NOTIFICATION } from '../queue.constants';
import { NotificationsService } from '../../notifications/notifications.service';
import { maskEmail } from '../../common/utils/log-preview.util';

export type SendNotificationJob = {
  type: 'order_confirmation' | 'shipment_update' | 'payment_confirmed';
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

  @OnWorkerEvent('ready')
  onWorkerReady(): void {
    this.logger.log(
      `[job:notify] worker=ready queue=${QUEUE_SEND_NOTIFICATION}`,
    );
  }

  @OnWorkerEvent('active')
  onJobActive(job: Job<SendNotificationJob>, prev: string): void {
    this.logger.log(
      `[job:notify] worker=picked_job jobId=${String(job.id)} type=${job.data.type} ` +
        `to=${maskEmail(job.data.toEmail)} prevState=${prev}`,
    );
  }

  @OnWorkerEvent('completed')
  onJobCompleted(job: Job<SendNotificationJob>, _result: unknown, prev: string): void {
    const runMs =
      job.finishedOn != null && job.processedOn != null
        ? job.finishedOn - job.processedOn
        : undefined;
    this.logger.log(
      `[job:notify] worker=job_completed jobId=${String(job.id)} type=${job.data.type} ` +
        `to=${maskEmail(job.data.toEmail)} prevState=${prev}` +
        (runMs != null ? ` processRunMs=${runMs}` : ''),
    );
  }

  @OnWorkerEvent('failed')
  onJobFailed(
    job: Job<SendNotificationJob> | undefined,
    err: Error,
    prev: string,
  ): void {
    const attemptsLeft =
      job != null
        ? (job.opts.attempts ?? 1) - (job.attemptsMade ?? 0)
        : undefined;
    this.logger.error(
      `[job:notify] worker=job_failed jobId=${job ? String(job.id) : 'n/a'} ` +
        `type=${job?.data?.type} to=${maskEmail(job?.data?.toEmail ?? '')} ` +
        `prevState=${prev} attemptsLeft=${attemptsLeft ?? 'n/a'}: ${err.message}`,
      err.stack,
    );
  }

  @OnWorkerEvent('error')
  onWorkerError(err: Error): void {
    this.logger.error(
      `[job:notify] worker=redis_or_runtime_error: ${err.message}`,
      err.stack,
    );
  }

  @OnWorkerEvent('stalled')
  onStalled(jobId: string, prev: string): void {
    this.logger.warn(
      `[job:notify] worker=stalled jobId=${jobId} prevState=${prev} — check Resend API latency`,
    );
  }

  async process(job: Job<SendNotificationJob>): Promise<void> {
    this.logger.log(
      `[job:notify] step=send type=${job.data.type} to=${maskEmail(job.data.toEmail)} ` +
        `jobId=${job.id} attemptsMade=${job.attemptsMade}`,
    );
    await this.notifications.sendEmail({
      to: job.data.toEmail,
      subject: job.data.subject,
      text: job.data.text,
      html: job.data.html,
      // Use the job ID as idempotency key — Resend deduplicates on this so a
      // BullMQ retry after a transient failure never delivers the email twice.
      idempotencyKey: job.id ? String(job.id) : undefined,
    });
    this.logger.log(
      `[job:notify] step=sent type=${job.data.type} to=${maskEmail(job.data.toEmail)}`,
    );
  }
}
