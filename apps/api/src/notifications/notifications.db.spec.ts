import { randomUUID } from 'node:crypto';
import { ServiceUnavailableException } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import type {
  CourseObservation,
  GroupObservation,
} from '@btu-course-watch/contracts';
import { ObservationsService } from '../observations/observations.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { NotificationsService } from './notifications.service.js';

const testUrl = process.env.OBSERVATION_TEST_DATABASE_URL;
const available =
  testUrl && new URL(testUrl).pathname === '/btu_course_watch_phase5a_test';
const chooseUrl = 'https://classroom.btu.edu.ge/ge/student/me/choose/13435';
const group = (status: 'FULL' | 'UNKNOWN' | 'AVAILABLE'): GroupObservation => ({
  btuGroupId: 'group-1',
  name: 'ჯგუფი 1.1',
  capacity: 27,
  status,
  chooseUrl: status === 'AVAILABLE' ? chooseUrl : null,
});

describe.skipIf(!available)(
  'Durable availability notifications with PostgreSQL',
  () => {
    let prisma: PrismaClient;
    let ingest: ObservationsService;
    let notifications: NotificationsService;
    const userIds = [randomUUID(), randomUUID()];
    const courses = new Set<string>();
    const t0 = Date.now() - 120_000;
    const at = (seconds: number) =>
      new Date(t0 + seconds * 1_000).toISOString();
    const course = () => {
      const id = `test_${randomUUID().replaceAll('-', '')}`;
      courses.add(id);
      return id;
    };
    const observation = (
      btuCourseId: string,
      seconds: number,
      groups: GroupObservation[],
    ): CourseObservation => ({
      btuCourseId,
      observedAt: at(seconds),
      courseName: null,
      groups,
    });
    const watch = async (btuCourseId: string, userId: string) => {
      const target = await prisma.group.findFirstOrThrow({
        where: { course: { btuCourseId }, btuGroupId: 'group-1' },
      });
      return prisma.watch.create({ data: { userId, groupId: target.id } });
    };
    const records = (btuCourseId: string) =>
      prisma.notification.findMany({
        where: { group: { course: { btuCourseId } } },
        include: { stateChange: true },
        orderBy: { createdAt: 'asc' },
      });

    beforeAll(async () => {
      prisma = new PrismaClient({ datasources: { db: { url: testUrl } } });
      await prisma.$connect();
      ingest = new ObservationsService(prisma as unknown as PrismaService);
      notifications = new NotificationsService(
        prisma as unknown as PrismaService,
      );
      await prisma.user.createMany({
        data: userIds.map((id) => ({
          id,
          email: `${id}@btu.edu.ge`,
          emailVerifiedAt: new Date(),
        })),
      });
    });
    afterEach(async () => {
      await prisma.course.deleteMany({
        where: { btuCourseId: { in: [...courses] } },
      });
      courses.clear();
    });
    afterAll(async () => {
      await prisma.user.deleteMany({ where: { id: { in: userIds } } });
      await prisma.$disconnect();
    });

    it('alerts both current watchers exactly once for FULL → AVAILABLE, then again after a real return', async () => {
      const id = course();
      await ingest.ingest(observation(id, 0, [group('FULL')]));
      await watch(id, userIds[0]);
      await watch(id, userIds[1]);
      const concurrent = await Promise.allSettled(
        Array.from({ length: 3 }, () =>
          ingest.ingest(observation(id, 1, [group('AVAILABLE')])),
        ),
      );
      for (const result of concurrent) {
        if (result.status === 'rejected')
          expect(result.reason).toBeInstanceOf(ServiceUnavailableException);
      }
      // Every contended caller may exhaust the bounded retry; this retry either
      // commits the transition or observes it as stale.
      await ingest.ingest(observation(id, 1, [group('AVAILABLE')]));
      let items = await records(id);
      expect(items).toHaveLength(2);
      expect(new Set(items.map((item) => item.userId))).toEqual(
        new Set(userIds),
      );
      expect(new Set(items.map((item) => item.stateChangeId)).size).toBe(1);
      expect(
        items.every((item) => item.stateChange.kind === 'STATUS_CHANGED'),
      ).toBe(true);
      await ingest.ingest(observation(id, 2, [group('AVAILABLE')]));
      await ingest.ingest(observation(id, 0, [group('FULL')]));
      await ingest.ingest(observation(id, 3, []));
      expect(await records(id)).toHaveLength(2);
      await ingest.ingest(observation(id, 4, [group('FULL')]));
      await ingest.ingest(observation(id, 5, [group('AVAILABLE')]));
      items = await records(id);
      expect(items).toHaveLength(4);
      expect(new Set(items.map((item) => item.stateChangeId)).size).toBe(2);
    });

    it('does not alert discovery, absent watchers, or a watcher removed before transition', async () => {
      const id = course();
      await ingest.ingest(observation(id, 0, [group('AVAILABLE')]));
      await watch(id, userIds[0]);
      expect(await records(id)).toHaveLength(0);
      await ingest.ingest(observation(id, 1, [group('FULL')]));
      await prisma.watch.deleteMany({ where: { userId: userIds[0] } });
      await ingest.ingest(observation(id, 2, [group('AVAILABLE')]));
      expect(await records(id)).toHaveLength(0);
    });

    it('alerts initial UNKNOWN → AVAILABLE but preserves definitive AVAILABLE through UNKNOWN', async () => {
      const first = course();
      await ingest.ingest(observation(first, 0, [group('UNKNOWN')]));
      await watch(first, userIds[0]);
      await ingest.ingest(observation(first, 1, [group('AVAILABLE')]));
      expect(await records(first)).toHaveLength(1);

      const second = course();
      await ingest.ingest(observation(second, 0, [group('AVAILABLE')]));
      await watch(second, userIds[0]);
      await ingest.ingest(observation(second, 1, [group('UNKNOWN')]));
      await ingest.ingest(observation(second, 2, [group('AVAILABLE')]));
      expect(await records(second)).toHaveLength(0);
    });

    it('lists only owned records, paginates, counts unread and marks read idempotently', async () => {
      const id = course();
      await ingest.ingest(observation(id, 0, [group('FULL')]));
      await watch(id, userIds[0]);
      await watch(id, userIds[1]);
      await ingest.ingest(observation(id, 1, [group('AVAILABLE')]));
      await ingest.ingest(observation(id, 2, [group('FULL')]));
      await ingest.ingest(observation(id, 3, [group('AVAILABLE')]));
      const first = await notifications.list(userIds[0], { limit: '1' });
      expect(first.items).toHaveLength(1);
      expect(first.unreadCount).toBe(2);
      expect(first.nextCursor).toBeTruthy();
      expect(JSON.stringify(first)).not.toMatch(/chooseUrl|userId|tokenHash/);
      const second = await notifications.list(userIds[0], {
        limit: '1',
        cursor: first.nextCursor,
      });
      expect(second.items).toHaveLength(1);
      expect(second.items[0].id).not.toBe(first.items[0].id);
      await expect(
        notifications.list(userIds[1], { cursor: first.items[0].id }),
      ).rejects.toThrow();
      await notifications.markRead(userIds[1], first.items[0].id);
      expect((await notifications.list(userIds[0], {})).unreadCount).toBe(2);
      await notifications.markRead(userIds[0], first.items[0].id);
      await notifications.markRead(userIds[0], first.items[0].id);
      expect((await notifications.list(userIds[0], {})).unreadCount).toBe(1);
      await notifications.markAllRead(userIds[0]);
      await notifications.markAllRead(userIds[0]);
      expect((await notifications.list(userIds[0], {})).unreadCount).toBe(0);
      expect((await notifications.list(userIds[1], {})).unreadCount).toBe(2);
    });
  },
);
