import { randomUUID } from 'node:crypto';
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
});

describe.skipIf(!available)('email outbox with PostgreSQL', () => {
  let prisma: PrismaClient;
  let ingest: ObservationsService;
  let worker: EmailDeliveryService;
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
});
