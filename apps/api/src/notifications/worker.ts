import { setTimeout as delay } from 'node:timers/promises';
import { Logger, Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { MAIL_SENDER } from '../auth/mail/mail-sender.js';
import { SmtpMailSender } from '../auth/mail/smtp-mail-sender.js';
import { validateEnvironment } from '../config/environment.js';
import { PrismaModule } from '../prisma/prisma.module.js';
import {
  EMAIL_DELIVERY_POLL_MS,
  EmailDeliveryService,
} from './email-delivery.service.js';
import { EmailDeliveryOperations } from './email-delivery.operations.js';

@Module({
  imports: [
    ConfigModule.forRoot({
      cache: true,
      isGlobal: true,
      validate: validateEnvironment,
    }),
    PrismaModule,
  ],
  providers: [
    EmailDeliveryService,
    EmailDeliveryOperations,
    SmtpMailSender,
    { provide: MAIL_SENDER, useExisting: SmtpMailSender },
  ],
})
class EmailDeliveryWorkerModule {}

async function run(): Promise<void> {
  const app = await NestFactory.createApplicationContext(
    EmailDeliveryWorkerModule,
  );
  const logger = new Logger('EmailDeliveryWorker');
  try {
    if (
      !app
        .get(ConfigService)
        .getOrThrow<boolean>('NOTIFICATION_EMAIL_DELIVERY_ENABLED')
    ) {
      logger.log('Notification email delivery is disabled; worker stopped');
      return;
    }
    const abort = new AbortController();
    process.once('SIGINT', () => abort.abort());
    process.once('SIGTERM', () => abort.abort());
    const service = app.get(EmailDeliveryService);
    const operations = app.get(EmailDeliveryOperations);
    await operations.recordWorkerStart();
    while (!abort.signal.aborted) {
      try {
        await service.processBatch(abort.signal);
        await operations.recordCycleCompleted();
      } catch {
        logger.warn('Email delivery cycle failed; pending leases will recover');
      }
      try {
        await delay(EMAIL_DELIVERY_POLL_MS, undefined, {
          signal: abort.signal,
        });
      } catch {
        // Abort interrupts idle waiting; in-flight SMTP work completes first.
      }
    }
  } finally {
    await app.close();
  }
}

void run().catch(() => {
  new Logger('EmailDeliveryWorker').error(
    'Email delivery worker could not start',
  );
  process.exitCode = 1;
});
