import { randomUUID } from 'node:crypto';
import { Logger } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import type { CourseObservation } from '@btu-course-watch/contracts';
import type {
  AvailabilityMessage,
  MailSender,
} from '../auth/mail/mail-sender.js';
import { ObservationsService } from '../observations/observations.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import {
  EmailDeliveryService,
  isPermanentSmtpFailure,
  retryDelayMs,
} from './email-delivery.service.js';
import {
  EmailDeliveryOperations,
  parseOperationsCommand,
  WORKER_STALE_AFTER_MS,
} from './email-delivery.operations.js';

const testUrl = process.env.OBSERVATION_TEST_DATABASE_URL;
const available =
  testUrl && new URL(testUrl).pathname === '/btu_course_watch_phase5a_test';

describe('email delivery policy', () => {
  it('bounds exponential retry with deterministic jitter', () => {
    expect(retryDelayMs(1, () => 0)).toBe(60_000);
    expect(retryDelayMs(2, () => 0.5)).toBe(132_000);
    expect(retryDelayMs(10, () => 1)).toBe(4_320_000);
  });

  it('treats only explicit SMTP 5xx responses as permanent', () => {
    expect(isPermanentSmtpFailure({ responseCode: 550 })).toBe(true);
    expect(isPermanentSmtpFailure({ responseCode: 451 })).toBe(false);
    expect(isPermanentSmtpFailure(new Error('network'))).toBe(false);
  });

  it('requires a privileged CLI command and explicit confirmation for recovery', () => {
    const id = randomUUID();
    expect(parseOperationsCommand(['status'])).toEqual({ kind: 'status' });
    expect(parseOperationsCommand(['failed'])).toEqual({
      kind: 'failed',
      page: 0,
    });
    expect(parseOperationsCommand(['failed', '--page', '2'])).toEqual({
      kind: 'failed',
      page: 2,
    });
    expect(() => parseOperationsCommand(['failed', '--page', '-1'])).toThrow();
    expect(
      parseOperationsCommand([
        'recover',
        id,
        '--operator',
        'ops-1',
        '--ticket',
        'INC-123',
      ]),
    ).toEqual({
      kind: 'recover',
      id,
      operator: 'ops-1',
      ticket: 'INC-123',
      confirm: false,
    });
    expect(
      parseOperationsCommand([
        'recover',
        id,
        '--operator',
        'ops-1',
        '--ticket',
        'INC-123',
        '--confirm',
      ]),
    ).toMatchObject({ kind: 'recover', confirm: true });
    expect(() =>
      parseOperationsCommand(['recover', id, '--confirm']),
    ).toThrow();
    expect(() =>
      parseOperationsCommand([
        'recover',
        id,
        '--operator',
        'a@btu.edu.ge',
        '--ticket',
        'INC-123',
        '--confirm',
      ]),
    ).toThrow();
    expect(() =>
      parseOperationsCommand([
        'recover',
        id,
        '--operator',
        'ops-1',
        '--ticket',
        'INC-123',
        '--confirm',
        '--confirm',
      ]),
    ).toThrow();
  });
});

describe.skipIf(!available)('email outbox with PostgreSQL', () => {
  let prisma: PrismaClient;
  let ingest: ObservationsService;
  let worker: EmailDeliveryService;
  let operations: EmailDeliveryOperations;
  const ownerId = randomUUID();
  const secondOwnerId = randomUUID();
  const unverifiedId = randomUUID();
  const courses = new Set<string>();
  const sendGroupAvailability = vi.fn(
    async (_message: AvailabilityMessage) => {},
  );
  const mailSender: MailSender = {
    sendEmailVerification: vi.fn(async () => {}),
    sendPasswordReset: vi.fn(async () => {}),
    sendGroupAvailability,
  };
  const t0 = Date.now() - 120_000;
  const at = (seconds: number) => new Date(t0 + seconds * 1000).toISOString();
  const course = () => {
    const id = `outbox_${randomUUID().replaceAll('-', '')}`;
    courses.add(id);
    return id;
  };
  const observation = (
    btuCourseId: string,
    seconds: number,
    status: 'FULL' | 'AVAILABLE' | 'UNKNOWN',
  ): CourseObservation => ({
    btuCourseId,
    courseName: 'Synthetic course',
    observedAt: at(seconds),
    groups: [
      {
        btuGroupId: 'synthetic-group',
        name: 'Synthetic group',
        capacity: 27,
        status,
        chooseUrl:
          status === 'AVAILABLE'
            ? 'https://classroom.btu.edu.ge/ge/student/me/choose/13435'
            : null,
      },
    ],
  });
  const records = (btuCourseId: string) =>
    prisma.notification.findMany({
      where: { group: { course: { btuCourseId } } },
      include: { emailDelivery: true },
      orderBy: { createdAt: 'asc' },
    });
  const watch = async (btuCourseId: string, userId = ownerId) => {
    const group = await prisma.group.findFirstOrThrow({
      where: { course: { btuCourseId }, btuGroupId: 'synthetic-group' },
    });
    await prisma.watch.create({ data: { userId, groupId: group.id } });
  };
  const enqueue = async (owners = [ownerId]) => {
    const id = course();
    await ingest.ingest(observation(id, 0, 'FULL'));
    for (const userId of owners) await watch(id, userId);
    await ingest.ingest(observation(id, 1, 'AVAILABLE'));
    // Give this test's jobs priority over unrelated due rows in the shared test DB.
    await prisma.emailDelivery.updateMany({
      where: { notification: { group: { course: { btuCourseId: id } } } },
      data: { nextAttemptAt: new Date(0) },
    });
    return id;
  };

  beforeAll(async () => {
    prisma = new PrismaClient({ datasources: { db: { url: testUrl } } });
    await prisma.$connect();
    ingest = new ObservationsService(prisma as unknown as PrismaService);
    worker = new EmailDeliveryService(
      prisma as unknown as PrismaService,
      mailSender,
    );
    operations = new EmailDeliveryOperations(
      prisma as unknown as PrismaService,
    );
    await prisma.user.createMany({
      data: [ownerId, secondOwnerId, unverifiedId].map((id) => ({
        id,
        email: `${id}@btu.edu.ge`,
        emailVerifiedAt: id === unverifiedId ? null : new Date(),
      })),
    });
  });
  beforeEach(() => sendGroupAvailability.mockReset());
  afterEach(async () => {
    await prisma.course.deleteMany({
      where: { btuCourseId: { in: [...courses] } },
    });
    courses.clear();
  });
  afterAll(async () => {
    await prisma.emailDeliveryWorkerHealth.deleteMany({
      where: { id: 'email' },
    });
    await prisma.user.deleteMany({
      where: { id: { in: [ownerId, secondOwnerId, unverifiedId] } },
    });
    await prisma.$disconnect();
  });

  it('transactionally creates one job per verified owner and no discovery/stale/duplicate jobs', async () => {
    const id = course();
    await ingest.ingest(observation(id, 0, 'AVAILABLE'));
    expect(await records(id)).toHaveLength(0);
    await watch(id, ownerId);
    await watch(id, secondOwnerId);
    await watch(id, unverifiedId);
    await ingest.ingest(observation(id, 1, 'FULL'));
    await ingest.ingest(observation(id, 2, 'AVAILABLE'));
    const first = await records(id);
    expect(first).toHaveLength(3);
    expect(first.filter((row) => row.emailDelivery)).toHaveLength(2);
    expect(
      first.find((row) => row.userId === unverifiedId)?.emailDelivery,
    ).toBeNull();
    await ingest.ingest(observation(id, 2, 'AVAILABLE'));
    await ingest.ingest(observation(id, 3, 'AVAILABLE'));
    await ingest.ingest(observation(id, 4, 'UNKNOWN'));
    await ingest.ingest(observation(id, 5, 'AVAILABLE'));
    expect((await records(id)).filter((row) => row.emailDelivery)).toHaveLength(
      2,
    );
    await ingest.ingest(observation(id, 6, 'FULL'));
    await ingest.ingest(observation(id, 7, 'AVAILABLE'));
    expect((await records(id)).filter((row) => row.emailDelivery)).toHaveLength(
      4,
    );
  });

  it('sends persisted work after a worker restart without changing read state', async () => {
    const id = await enqueue();
    const restarted = new EmailDeliveryService(
      prisma as unknown as PrismaService,
      mailSender,
    );
    await restarted.processBatch();
    const [item] = await records(id);
    expect(sendGroupAvailability).toHaveBeenCalledWith(
      expect.objectContaining({
        to: `${ownerId}@btu.edu.ge`,
        courseName: 'Synthetic course',
        groupName: 'Synthetic group',
        observedAt: new Date(at(1)),
      }),
    );
    expect(item.emailDelivery).toMatchObject({ status: 'SENT', attempts: 1 });
    expect(item.emailDelivery?.sentAt).toBeInstanceOf(Date);
    expect(item.readAt).toBeNull();
    await restarted.processBatch();
    expect(
      sendGroupAvailability.mock.calls.filter(
        ([message]) => message.to === `${ownerId}@btu.edu.ge`,
      ),
    ).toHaveLength(1);
  });

  it('retries transient SMTP failures, but exhausts or immediately fails permanent errors', async () => {
    const id = await enqueue();
    sendGroupAvailability.mockRejectedValueOnce(new Error('network'));
    await worker.processBatch();
    let [item] = await records(id);
    expect(item.emailDelivery).toMatchObject({
      status: 'RETRY',
      attempts: 1,
      lastFailure: 'SMTP_TRANSIENT',
    });
    expect(item.emailDelivery?.nextAttemptAt!.getTime()).toBeGreaterThan(
      Date.now(),
    );
    await prisma.emailDelivery.update({
      where: { notificationId: item.id },
      data: { nextAttemptAt: new Date(0) },
    });
    await worker.processBatch();
    [item] = await records(id);
    expect(item.emailDelivery).toMatchObject({ status: 'SENT', attempts: 2 });

    const permanentId = await enqueue();
    sendGroupAvailability.mockRejectedValueOnce({ responseCode: 550 });
    await worker.processBatch();
    expect((await records(permanentId))[0].emailDelivery).toMatchObject({
      status: 'FAILED',
      attempts: 1,
      lastFailure: 'SMTP_PERMANENT',
    });

    const exhaustedId = await enqueue();
    const [exhausted] = await records(exhaustedId);
    await prisma.emailDelivery.update({
      where: { notificationId: exhausted.id },
      data: { attempts: 4 },
    });
    sendGroupAvailability.mockRejectedValueOnce(new Error('network'));
    await worker.processBatch();
    expect((await records(exhaustedId))[0].emailDelivery).toMatchObject({
      status: 'FAILED',
      attempts: 5,
      lastFailure: 'SMTP_TRANSIENT',
    });
  });

  it('recovers abandoned leases and only one concurrent worker claims each job', async () => {
    const id = await enqueue();
    const [item] = await records(id);
    await prisma.emailDelivery.update({
      where: { notificationId: item.id },
      data: {
        status: 'PROCESSING',
        attempts: 1,
        claimToken: randomUUID(),
        leaseExpiresAt: new Date(Date.now() - 1000),
      },
    });
    const other = new EmailDeliveryService(
      prisma as unknown as PrismaService,
      mailSender,
    );
    await Promise.all([worker.processBatch(), other.processBatch()]);
    expect((await records(id))[0].emailDelivery).toMatchObject({
      status: 'SENT',
      attempts: 2,
    });
    expect(
      sendGroupAvailability.mock.calls.filter(
        ([message]) => message.to === `${ownerId}@btu.edu.ge`,
      ),
    ).toHaveLength(1);
  });

  it('marks an exhausted abandoned lease failed rather than sending again', async () => {
    const id = await enqueue();
    const [item] = await records(id);
    await prisma.emailDelivery.update({
      where: { notificationId: item.id },
      data: {
        status: 'PROCESSING',
        attempts: 5,
        claimToken: randomUUID(),
        leaseExpiresAt: new Date(Date.now() - 1000),
      },
    });
    await worker.processBatch();
    expect((await records(id))[0].emailDelivery).toMatchObject({
      status: 'FAILED',
      lastFailure: 'LEASE_EXHAUSTED',
    });
    expect(
      sendGroupAvailability.mock.calls.filter(
        ([message]) => message.to === `${ownerId}@btu.edu.ge`,
      ),
    ).toHaveLength(0);
  });

  it('treats SMTP-accepted-but-unrecorded work as ambiguous and may retry it', async () => {
    const id = await enqueue();
    const [item] = await records(id);
    // Simulate acceptance followed by a process crash before the SENT update.
    await mailSender.sendGroupAvailability({
      to: `${ownerId}@btu.edu.ge`,
      courseName: 'Synthetic course',
      groupName: 'Synthetic group',
      btuCourseId: id,
      btuGroupId: 'synthetic-group',
      observedAt: new Date(at(1)),
    });
    await prisma.emailDelivery.update({
      where: { notificationId: item.id },
      data: {
        status: 'PROCESSING',
        attempts: 1,
        claimToken: randomUUID(),
        leaseExpiresAt: new Date(Date.now() - 1000),
      },
    });
    await worker.processBatch();
    expect((await records(id))[0].emailDelivery?.status).toBe('SENT');
    expect(
      sendGroupAvailability.mock.calls.filter(
        ([message]) => message.to === `${ownerId}@btu.edu.ge`,
      ),
    ).toHaveLength(2);
  });

  it('does not send when a previously verified recipient loses eligibility', async () => {
    const id = await enqueue();
    await prisma.user.update({
      where: { id: ownerId },
      data: { emailVerifiedAt: null },
    });
    await worker.processBatch();
    expect((await records(id))[0].emailDelivery).toMatchObject({
      status: 'FAILED',
      lastFailure: 'RECIPIENT_INELIGIBLE',
    });
    expect(
      sendGroupAvailability.mock.calls.filter(
        ([message]) => message.to === `${ownerId}@btu.edu.ge`,
      ),
    ).toHaveLength(0);
    await prisma.user.update({
      where: { id: ownerId },
      data: { emailVerifiedAt: new Date() },
    });
  });

  it('cascades jobs when an account is deleted and stops before claiming after shutdown', async () => {
    const temporaryId = randomUUID();
    await prisma.user.create({
      data: {
        id: temporaryId,
        email: `${temporaryId}@btu.edu.ge`,
        emailVerifiedAt: new Date(),
      },
    });
    const id = await enqueue([temporaryId]);
    const abort = new AbortController();
    abort.abort();
    await worker.processBatch(abort.signal);
    expect((await records(id))[0].emailDelivery?.status).toBe('PENDING');
    await prisma.user.delete({ where: { id: temporaryId } });
    expect(await records(id)).toHaveLength(0);
    await worker.processBatch();
    expect(
      sendGroupAvailability.mock.calls.filter(
        ([message]) => message.to === `${temporaryId}@btu.edu.ge`,
      ),
    ).toHaveLength(0);
  });

  it('reports aggregate backlog, expired leases, failure classes and a stale worker', async () => {
    const before = await operations.status();
    const id = await enqueue();
    const [item] = await records(id);
    await prisma.emailDelivery.update({
      where: { notificationId: item.id },
      data: {
        createdAt: new Date(Date.now() - 120_000),
        lastAttemptAt: new Date(),
        lastFailure: 'SMTP_TRANSIENT',
      },
    });
    const pending = await operations.status();
    expect(pending.counts.PENDING).toBe(before.counts.PENDING + 1);
    expect(pending.oldestActionableAgeSeconds).toBeGreaterThanOrEqual(119);
    expect(pending.recentFailures24h.SMTP_TRANSIENT).toBeGreaterThanOrEqual(1);

    await prisma.emailDelivery.update({
      where: { notificationId: item.id },
      data: {
        status: 'PROCESSING',
        attempts: 1,
        claimToken: randomUUID(),
        leaseExpiresAt: new Date(Date.now() - 1000),
      },
    });
    const processing = await operations.status();
    expect(processing.expiredProcessingLeases).toBe(
      before.expiredProcessingLeases + 1,
    );
    await operations.recordWorkerStart();
    await operations.recordCycleCompleted();
    expect((await operations.status()).worker.stale).toBe(false);
    await prisma.emailDeliveryWorkerHealth.update({
      where: { id: 'email' },
      data: {
        lastCycleCompletedAt: new Date(
          Date.now() - WORKER_STALE_AFTER_MS - 1000,
        ),
      },
    });
    expect((await operations.status()).worker.stale).toBe(true);
  });

  it('dry-runs and audits bounded, idempotent recovery without replaying SENT jobs', async () => {
    const id = await enqueue();
    const [item] = await records(id);
    const jobId = item.emailDelivery!.id;
    await prisma.emailDelivery.update({
      where: { id: jobId },
      data: {
        status: 'FAILED',
        attempts: 5,
        nextAttemptAt: null,
        failedAt: new Date(),
        lastFailure: 'SMTP_TRANSIENT',
      },
    });
    expect(
      (await operations.failed()).items.find((row) => row.id === jobId),
    ).toEqual({
      id: jobId,
      attempts: 5,
      recoveryCount: 0,
      lastFailure: 'SMTP_TRANSIENT',
      failedAt: expect.any(Date),
    });
    const command = {
      kind: 'recover' as const,
      id: jobId,
      operator: 'ops-1',
      ticket: 'INC-123',
      confirm: false,
    };
    expect(await operations.recover(command)).toEqual({
      outcome: 'dry-run-eligible',
    });
    expect(
      await prisma.emailDeliveryRecovery.count({
        where: { deliveryId: jobId },
      }),
    ).toBe(0);
    expect(
      (await prisma.emailDelivery.findUniqueOrThrow({ where: { id: jobId } }))
        .status,
    ).toBe('FAILED');
    expect(await operations.recover({ ...command, confirm: true })).toEqual({
      outcome: 'requeued',
    });
    expect(await operations.recover({ ...command, confirm: true })).toEqual({
      outcome: 'already-recovered',
    });
    expect(
      await prisma.emailDeliveryRecovery.findMany({
        where: { deliveryId: jobId },
      }),
    ).toEqual([
      expect.objectContaining({
        operator: 'ops-1',
        ticket: 'INC-123',
        previousAttempts: 5,
        previousFailure: 'SMTP_TRANSIENT',
      }),
    ]);
    expect(
      await prisma.emailDelivery.findUniqueOrThrow({ where: { id: jobId } }),
    ).toMatchObject({ status: 'RETRY', attempts: 0, recoveryCount: 1 });
    await worker.processBatch();
    expect(
      (await prisma.emailDelivery.findUniqueOrThrow({ where: { id: jobId } }))
        .status,
    ).toBe('SENT');
    expect(
      await operations.recover({
        ...command,
        ticket: 'INC-124',
        confirm: true,
      }),
    ).toEqual({ outcome: 'not-failed' });
  });

  it('rejects ineligible recipients and caps manual recovery at two cycles', async () => {
    const id = await enqueue();
    const [item] = await records(id);
    const jobId = item.emailDelivery!.id;
    await prisma.emailDelivery.update({
      where: { id: jobId },
      data: { status: 'FAILED', attempts: 5, nextAttemptAt: null },
    });
    await prisma.user.update({
      where: { id: ownerId },
      data: { emailVerifiedAt: null },
    });
    const command = {
      kind: 'recover' as const,
      id: jobId,
      operator: 'ops-1',
      ticket: 'INC-201',
      confirm: true,
    };
    expect(await operations.recover(command)).toEqual({
      outcome: 'recipient-ineligible',
    });
    expect(
      await prisma.emailDeliveryRecovery.count({
        where: { deliveryId: jobId },
      }),
    ).toBe(0);
    await prisma.user.update({
      where: { id: ownerId },
      data: { emailVerifiedAt: new Date() },
    });
    expect(await operations.recover(command)).toEqual({ outcome: 'requeued' });
    await prisma.emailDelivery.update({
      where: { id: jobId },
      data: { status: 'FAILED', attempts: 5, nextAttemptAt: null },
    });
    expect(await operations.recover({ ...command, ticket: 'INC-202' })).toEqual(
      { outcome: 'requeued' },
    );
    await prisma.emailDelivery.update({
      where: { id: jobId },
      data: { status: 'FAILED', attempts: 5, nextAttemptAt: null },
    });
    expect(await operations.recover({ ...command, ticket: 'INC-203' })).toEqual(
      { outcome: 'limit-reached' },
    );
    expect(
      await prisma.emailDeliveryRecovery.count({
        where: { deliveryId: jobId },
      }),
    ).toBe(2);
    expect(sendGroupAvailability).not.toHaveBeenCalled();
  });

  it('serializes concurrent recovery approvals to one requeue', async () => {
    const id = await enqueue();
    const [item] = await records(id);
    const jobId = item.emailDelivery!.id;
    await prisma.emailDelivery.update({
      where: { id: jobId },
      data: { status: 'FAILED', attempts: 5, nextAttemptAt: null },
    });
    const results = await Promise.all([
      operations.recover({
        kind: 'recover',
        id: jobId,
        operator: 'ops-1',
        ticket: 'INC-301',
        confirm: true,
      }),
      operations.recover({
        kind: 'recover',
        id: jobId,
        operator: 'ops-2',
        ticket: 'INC-302',
        confirm: true,
      }),
    ]);
    expect(results.map((result) => result.outcome).sort()).toEqual([
      'not-failed',
      'requeued',
    ]);
    expect(
      await prisma.emailDeliveryRecovery.count({
        where: { deliveryId: jobId },
      }),
    ).toBe(1);
  });

  it('finishes an in-flight send after shutdown but does not claim another job', async () => {
    const first = await enqueue();
    const second = await enqueue();
    await prisma.emailDelivery.updateMany({
      where: { notification: { group: { course: { btuCourseId: second } } } },
      data: { nextAttemptAt: new Date(1) },
    });
    const abort = new AbortController();
    sendGroupAvailability.mockImplementationOnce(async () => {
      abort.abort();
    });
    await worker.processBatch(abort.signal);
    expect((await records(first))[0].emailDelivery?.status).toBe('SENT');
    expect((await records(second))[0].emailDelivery?.status).toBe('PENDING');
    expect(sendGroupAvailability).toHaveBeenCalledTimes(1);
  });

  it('logs only a coarse failure category, never the SMTP error text', async () => {
    const id = await enqueue();
    const log = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => {});
    try {
      sendGroupAvailability.mockRejectedValueOnce({
        responseCode: 550,
        message: 'sensitive provider diagnostic',
      });
      await worker.processBatch();
      expect((await records(id))[0].emailDelivery?.status).toBe('FAILED');
      expect(log).toHaveBeenCalledWith(
        expect.stringContaining('SMTP_PERMANENT'),
      );
      expect(JSON.stringify(log.mock.calls)).not.toContain(
        'sensitive provider diagnostic',
      );
    } finally {
      log.mockRestore();
    }
  });
});
