import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { type EmailDeliveryFailure } from '@prisma/client';
import { btuEmailSchema } from '../auth/auth.validation.js';
import { MAIL_SENDER, type MailSender } from '../auth/mail/mail-sender.js';
import { PrismaService } from '../prisma/prisma.service.js';

export const EMAIL_DELIVERY_BATCH_SIZE = 10;
export const EMAIL_DELIVERY_POLL_MS = 15_000;
export const EMAIL_DELIVERY_MAX_ATTEMPTS = 5;
const LEASE_SECONDS = 120;

type ClaimedDelivery = {
  id: string;
  notificationId: string;
  attempts: number;
  claimToken: string;
};

export function retryDelayMs(attempt: number, random = Math.random): number {
  const base = Math.min(60_000 * 2 ** (attempt - 1), 3_600_000);
  return base + Math.floor(base * 0.2 * random());
}

export function isPermanentSmtpFailure(error: unknown): boolean {
  if (!error || typeof error !== 'object' || !('responseCode' in error))
    return false;
  const code = error.responseCode;
  return typeof code === 'number' && code >= 500 && code < 600;
}

@Injectable()
export class EmailDeliveryService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(MAIL_SENDER) private readonly mailSender: MailSender,
  ) {}

  async processBatch(signal?: AbortSignal): Promise<number> {
    await this.prisma.emailDelivery.updateMany({
      where: {
        status: 'PROCESSING',
        leaseExpiresAt: { lte: new Date() },
        attempts: { gte: EMAIL_DELIVERY_MAX_ATTEMPTS },
      },
      data: {
        status: 'FAILED',
        failedAt: new Date(),
        leaseExpiresAt: null,
        claimToken: null,
        lastFailure: 'LEASE_EXHAUSTED',
      },
    });

    let processed = 0;
    for (
      ;
      processed < EMAIL_DELIVERY_BATCH_SIZE && !signal?.aborted;
      processed++
    ) {
      const claim = await this.claimNext();
      if (!claim) break;
      await this.deliver(claim);
    }
    return processed;
  }

  private async claimNext(): Promise<ClaimedDelivery | null> {
    const token = randomUUID();
    // A one-row lease starts immediately before its SMTP operation, never
    // before earlier jobs in the batch. SKIP LOCKED permits independent workers.
    const rows = await this.prisma.$queryRaw<ClaimedDelivery[]>`
      WITH candidate AS (
        SELECT "id" FROM "EmailDelivery"
        WHERE "attempts" < ${EMAIL_DELIVERY_MAX_ATTEMPTS}
          AND (
            ("status" IN ('PENDING', 'RETRY') AND "nextAttemptAt" <= NOW())
            OR ("status" = 'PROCESSING' AND "leaseExpiresAt" <= NOW())
          )
        ORDER BY "nextAttemptAt" ASC NULLS LAST, "id" ASC
        FOR UPDATE SKIP LOCKED
        LIMIT 1
      )
      UPDATE "EmailDelivery" AS delivery
      SET "status" = 'PROCESSING',
          "attempts" = delivery."attempts" + 1,
          "claimToken" = ${token}::uuid,
          "leaseExpiresAt" = NOW() + (${LEASE_SECONDS} * INTERVAL '1 second'),
          "lastAttemptAt" = NOW(),
          "updatedAt" = NOW()
      FROM candidate
      WHERE delivery."id" = candidate."id"
      RETURNING delivery."id", delivery."notificationId", delivery."attempts", delivery."claimToken"
    `;
    return rows[0] ?? null;
  }

  private async deliver(claim: ClaimedDelivery): Promise<void> {
    const notification = await this.prisma.notification.findUnique({
      where: { id: claim.notificationId },
      include: {
        user: true,
        stateChange: true,
        group: { include: { course: true } },
      },
    });
    if (!notification) return; // Cascade deletion removed the job too.

    const recipient = btuEmailSchema.safeParse(notification.user.email);
    if (!notification.user.emailVerifiedAt || !recipient.success) {
      await this.finishFailure(claim, 'RECIPIENT_INELIGIBLE', true);
      return;
    }

    try {
      await this.mailSender.sendGroupAvailability({
        to: recipient.data,
        courseName: notification.group.course.name,
        groupName: notification.group.name,
        btuCourseId: notification.group.course.btuCourseId,
        btuGroupId: notification.group.btuGroupId,
        observedAt: notification.stateChange.observedAt,
      });
    } catch (error) {
      await this.finishFailure(
        claim,
        isPermanentSmtpFailure(error) ? 'SMTP_PERMANENT' : 'SMTP_TRANSIENT',
        isPermanentSmtpFailure(error),
      );
      return;
    }

    await this.prisma.emailDelivery.updateMany({
      where: {
        id: claim.id,
        status: 'PROCESSING',
        claimToken: claim.claimToken,
      },
      data: {
        status: 'SENT',
        sentAt: new Date(),
        nextAttemptAt: null,
        leaseExpiresAt: null,
        claimToken: null,
        lastFailure: null,
      },
    });
  }

  private async finishFailure(
    claim: ClaimedDelivery,
    reason: EmailDeliveryFailure,
    permanent: boolean,
  ): Promise<void> {
    const exhausted =
      permanent || claim.attempts >= EMAIL_DELIVERY_MAX_ATTEMPTS;
    await this.prisma.emailDelivery.updateMany({
      where: {
        id: claim.id,
        status: 'PROCESSING',
        claimToken: claim.claimToken,
      },
      data: {
        status: exhausted ? 'FAILED' : 'RETRY',
        nextAttemptAt: exhausted
          ? null
          : new Date(Date.now() + retryDelayMs(claim.attempts)),
        failedAt: exhausted ? new Date() : null,
        leaseExpiresAt: null,
        claimToken: null,
        lastFailure: reason,
      },
    });
  }
}
