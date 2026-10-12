import { Injectable } from '@nestjs/common';
import type { EmailDeliveryFailure, EmailDeliveryStatus } from '@prisma/client';
import { btuEmailSchema } from '../auth/auth.validation.js';
import { PrismaService } from '../prisma/prisma.service.js';

export const WORKER_STALE_AFTER_MS = 10 * 60_000;
export const MAX_MANUAL_RECOVERIES = 2;
const WORKER_HEALTH_ID = 'email';
const AUDIT_LABEL = /^[A-Za-z0-9][A-Za-z0-9._-]{2,79}$/;
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type OperationsCommand =
  | { kind: 'status' }
  | { kind: 'failed'; page: number }
  | {
      kind: 'recover';
      id: string;
      operator: string;
      ticket: string;
      confirm: boolean;
    };

export function parseOperationsCommand(args: string[]): OperationsCommand {
  if (args.length === 1 && args[0] === 'status') return { kind: 'status' };
  if (args[0] === 'failed') {
    if (args.length === 1) return { kind: 'failed', page: 0 };
    const page = Number(args[2]);
    if (
      args.length === 3 &&
      args[1] === '--page' &&
      /^[0-9]+$/.test(args[2] ?? '') &&
      Number.isInteger(page) &&
      page <= 1000
    )
      return { kind: 'failed', page };
    throw new Error('Usage: email-ops failed [--page 0..1000]');
  }
  if (args[0] !== 'recover' || !args[1] || !UUID.test(args[1]))
    throw new Error(
      'Usage: email-ops status | failed [--page 0..1000] | recover <job-uuid> --operator <id> --ticket <id> [--confirm]',
    );

  let operator: string | undefined;
  let ticket: string | undefined;
  let confirm = false;
  for (let i = 2; i < args.length; i++) {
    if (args[i] === '--operator' && !operator) operator = args[++i];
    else if (args[i] === '--ticket' && !ticket) ticket = args[++i];
    else if (args[i] === '--confirm' && !confirm) confirm = true;
    else throw new Error('Invalid recovery arguments');
  }
  if (
    !operator ||
    !ticket ||
    !AUDIT_LABEL.test(operator) ||
    !AUDIT_LABEL.test(ticket)
  )
    throw new Error(
      'Recovery requires an operator and ticket ID (3–80 letters, digits, dots, underscores, or hyphens)',
    );
  return { kind: 'recover', id: args[1], operator, ticket, confirm };
}

@Injectable()
export class EmailDeliveryOperations {
  constructor(private readonly prisma: PrismaService) {}

  async recordWorkerStart(): Promise<void> {
    await this.prisma.emailDeliveryWorkerHealth.upsert({
      where: { id: WORKER_HEALTH_ID },
      create: { id: WORKER_HEALTH_ID, lastStartedAt: new Date() },
      update: { lastStartedAt: new Date() },
    });
  }

  async recordCycleCompleted(): Promise<void> {
    const now = new Date();
    await this.prisma.emailDeliveryWorkerHealth.upsert({
      where: { id: WORKER_HEALTH_ID },
      create: {
        id: WORKER_HEALTH_ID,
        lastStartedAt: now,
        lastCycleCompletedAt: now,
      },
      update: { lastCycleCompletedAt: now },
    });
  }

  async status(now = new Date()) {
    const since = new Date(now.getTime() - 24 * 60 * 60_000);
    const [byStatus, oldest, expiredLeases, recent, worker] = await Promise.all(
      [
        this.prisma.emailDelivery.groupBy({
          by: ['status'],
          _count: { _all: true },
        }),
        this.prisma.emailDelivery.findFirst({
          where: {
            status: { in: ['PENDING', 'RETRY'] },
            nextAttemptAt: { lte: now },
          },
          orderBy: { createdAt: 'asc' },
          select: { createdAt: true },
        }),
        this.prisma.emailDelivery.count({
          where: { status: 'PROCESSING', leaseExpiresAt: { lte: now } },
        }),
        this.prisma.emailDelivery.groupBy({
          by: ['lastFailure'],
          where: { lastFailure: { not: null }, lastAttemptAt: { gte: since } },
          _count: { _all: true },
        }),
        this.prisma.emailDeliveryWorkerHealth.findUnique({
          where: { id: WORKER_HEALTH_ID },
        }),
      ],
    );
    const counts: Record<EmailDeliveryStatus, number> = {
      PENDING: 0,
      PROCESSING: 0,
      RETRY: 0,
      SENT: 0,
      FAILED: 0,
    };
    for (const row of byStatus) counts[row.status] = row._count._all;
    const recentFailures24h: Partial<Record<EmailDeliveryFailure, number>> = {};
    for (const row of recent) {
      if (row.lastFailure) recentFailures24h[row.lastFailure] = row._count._all;
    }
    return {
      asOf: now.toISOString(),
      counts,
      oldestActionableAgeSeconds: oldest
        ? Math.max(
            0,
            Math.floor((now.getTime() - oldest.createdAt.getTime()) / 1000),
          )
        : null,
      expiredProcessingLeases: expiredLeases,
      recentFailures24h,
      worker: {
        lastStartedAt: worker?.lastStartedAt.toISOString() ?? null,
        lastCycleCompletedAt:
          worker?.lastCycleCompletedAt?.toISOString() ?? null,
        stale:
          !worker?.lastCycleCompletedAt ||
          now.getTime() - worker.lastCycleCompletedAt.getTime() >
            WORKER_STALE_AFTER_MS,
      },
    };
  }

  async failed(page = 0) {
    const items = await this.prisma.emailDelivery.findMany({
      where: { status: 'FAILED' },
      orderBy: [{ failedAt: 'asc' }, { id: 'asc' }],
      skip: page * 20,
      take: 20,
      select: {
        id: true,
        attempts: true,
        recoveryCount: true,
        lastFailure: true,
        failedAt: true,
      },
    });
    return { page, items };
  }

  async recover(command: Extract<OperationsCommand, { kind: 'recover' }>) {
    // Validate again because this method is also called outside the CLI parser.
    if (
      !UUID.test(command.id) ||
      !AUDIT_LABEL.test(command.operator) ||
      !AUDIT_LABEL.test(command.ticket)
    )
      throw new Error('Invalid recovery identifier');
    return this.prisma.$transaction(async (tx) => {
      const locked = await tx.$queryRaw<{ id: string }[]>`
        SELECT "id" FROM "EmailDelivery" WHERE "id" = ${command.id}::uuid FOR UPDATE
      `;
      if (!locked.length) return { outcome: 'not-found' as const };
      const job = await tx.emailDelivery.findUniqueOrThrow({
        where: { id: command.id },
        include: {
          notification: { include: { user: true } },
          recoveries: {
            where: { ticket: command.ticket },
            select: { id: true },
          },
        },
      });
      if (job.recoveries.length)
        return { outcome: 'already-recovered' as const };
      if (job.status !== 'FAILED') return { outcome: 'not-failed' as const };
      if (job.recoveryCount >= MAX_MANUAL_RECOVERIES)
        return { outcome: 'limit-reached' as const };
      const user = job.notification.user;
      if (
        !user.emailVerifiedAt ||
        !btuEmailSchema.safeParse(user.email).success
      )
        return { outcome: 'recipient-ineligible' as const };
      if (!command.confirm) return { outcome: 'dry-run-eligible' as const };
      await tx.emailDeliveryRecovery.create({
        data: {
          deliveryId: job.id,
          operator: command.operator,
          ticket: command.ticket,
          previousAttempts: job.attempts,
          previousFailure: job.lastFailure,
        },
      });
      await tx.emailDelivery.update({
        where: { id: job.id },
        data: {
          status: 'RETRY',
          attempts: 0,
          recoveryCount: { increment: 1 },
          nextAttemptAt: new Date(),
          failedAt: null,
          lastFailure: null,
          leaseExpiresAt: null,
          claimToken: null,
        },
      });
      return { outcome: 'requeued' as const };
    });
  }
}
