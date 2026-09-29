import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import type {
  CourseObservation,
  GroupObservation,
} from '@btu-course-watch/contracts';
import { PrismaService } from '../prisma/prisma.service.js';
import { ObservationsService } from './observations.service.js';

const testUrl = process.env.OBSERVATION_TEST_DATABASE_URL;
const available =
  testUrl && new URL(testUrl).pathname === '/btu_course_watch_phase5a_test';
const chooseUrl = 'https://classroom.btu.edu.ge/ge/student/me/choose/13435';
const full = (btuGroupId: string): GroupObservation => ({
  btuGroupId,
  name: `ჯგუფი ${btuGroupId}`,
  capacity: 27,
  status: 'FULL',
  chooseUrl: null,
});
const availableGroup = (btuGroupId: string): GroupObservation => ({
  ...full(btuGroupId),
  status: 'AVAILABLE',
  chooseUrl,
});
const unknown = (btuGroupId: string): GroupObservation => ({
  ...full(btuGroupId),
  status: 'UNKNOWN',
  chooseUrl: null,
});

describe.skipIf(!available)('Observation ingestion with PostgreSQL', () => {
  let prisma: PrismaClient;
  let service: ObservationsService;
  const courseIds = new Set<string>();
  const t0 = Date.now() - 60_000;
  const at = (seconds: number) => new Date(t0 + seconds * 1_000).toISOString();
  const courseId = () => {
    const id = `test_${randomUUID().replaceAll('-', '')}`;
    courseIds.add(id);
    return id;
  };
  const observation = (
    btuCourseId: string,
    observedAt: string,
    groups: GroupObservation[],
  ): CourseObservation => ({
    btuCourseId,
    observedAt,
    courseName: null,
    groups,
  });

  beforeAll(async () => {
    prisma = new PrismaClient({ datasources: { db: { url: testUrl } } });
    await prisma.$connect();
    service = new ObservationsService(prisma as unknown as PrismaService);
  });
  afterEach(async () => {
    await prisma.course.deleteMany({
      where: { btuCourseId: { in: [...courseIds] } },
    });
    courseIds.clear();
  });
  afterAll(async () => prisma.$disconnect());

  it('creates course-scoped groups and discovery events without an observation log', async () => {
    const id = courseId();
    const result = await service.ingest(
      observation(id, at(0), [full('1'), availableGroup('2')]),
    );
    expect(result).toEqual({
      btuCourseId: id,
      groupsCreated: 2,
      groupsUpdated: 0,
      groupsSkipped: 0,
      discoveryEventsCreated: 2,
      statusChangesCreated: 0,
    });
    const course = await prisma.course.findUniqueOrThrow({
      where: { btuCourseId: id },
      include: { groups: { include: { stateChanges: true } } },
    });
    expect(course.groups).toHaveLength(2);
    expect(course.groups.map((group) => group.btuGroupId).sort()).toEqual([
      '1',
      '2',
    ]);
    for (const group of course.groups) {
      expect(group.stateChanges).toMatchObject([
        {
          kind: 'DISCOVERED',
          previousStatus: null,
          status: group.status,
        },
      ]);
    }
    const publicState = await service.courseState(id);
    expect(publicState.groups).toHaveLength(2);
    expect(publicState.recentChanges).toHaveLength(2);
    expect(JSON.stringify(publicState)).not.toContain(chooseUrl);
  });

  it('skips equal/older scans and advances a fresh identical scan without duplicate history', async () => {
    const id = courseId();
    await service.ingest(observation(id, at(0), [full('1')]));
    expect(
      (await service.ingest(observation(id, at(0), [availableGroup('1')])))
        .groupsSkipped,
    ).toBe(1);
    expect(
      (await service.ingest(observation(id, at(-1), [availableGroup('1')])))
        .groupsSkipped,
    ).toBe(1);
    const fresh = await service.ingest(observation(id, at(1), [full('1')]));
    expect(fresh).toMatchObject({ groupsUpdated: 1, statusChangesCreated: 0 });
    const group = await prisma.group.findFirstOrThrow({
      where: { course: { btuCourseId: id } },
      include: { stateChanges: true },
    });
    expect(group.status).toBe('FULL');
    expect(group.lastObservedAt.toISOString()).toBe(at(1));
    expect(group.stateChanges).toHaveLength(1);
  });

  it('records one accepted FULL → AVAILABLE transition and ignores stale metadata', async () => {
    const id = courseId();
    await service.ingest(observation(id, at(0), [full('1')]));
    const changed = await service.ingest(
      observation(id, at(2), [availableGroup('1')]),
    );
    expect(changed.statusChangesCreated).toBe(1);
    await service.ingest(
      observation(id, at(1), [{ ...full('1'), name: 'stale', capacity: 999 }]),
    );
    const group = await prisma.group.findFirstOrThrow({
      where: { course: { btuCourseId: id } },
      include: { stateChanges: { orderBy: { observedAt: 'asc' } } },
    });
    expect(group.status).toBe('AVAILABLE');
    expect(group.name).toBe('ჯგუფი 1');
    expect(group.capacity).toBe(27);
    expect(
      group.stateChanges.map((change) => [
        change.kind,
        change.previousStatus,
        change.status,
      ]),
    ).toEqual([
      ['DISCOVERED', null, 'FULL'],
      ['STATUS_CHANGED', 'FULL', 'AVAILABLE'],
    ]);
  });

  it('preserves definitive state on UNKNOWN but clears the unconfirmed Choose URL', async () => {
    const id = courseId();
    await service.ingest(observation(id, at(0), [availableGroup('1')]));
    const accepted = await service.ingest(
      observation(id, at(1), [unknown('1')]),
    );
    expect(accepted).toMatchObject({
      groupsUpdated: 1,
      statusChangesCreated: 0,
    });
    let group = await prisma.group.findFirstOrThrow({
      where: { course: { btuCourseId: id } },
      include: { stateChanges: true },
    });
    expect(group).toMatchObject({ status: 'AVAILABLE', chooseUrl: null });
    expect(group.stateChanges).toHaveLength(1);
    await service.ingest(observation(id, at(2), [full('1')]));
    group = await prisma.group.findFirstOrThrow({
      where: { course: { btuCourseId: id } },
      include: { stateChanges: true },
    });
    expect(group.status).toBe('FULL');
    expect(group.stateChanges).toHaveLength(2);
  });

  it('discovers a later group by ID, preserves omitted groups, and accepts initial UNKNOWN', async () => {
    const id = courseId();
    await service.ingest(observation(id, at(0), [full('1')]));
    const result = await service.ingest(observation(id, at(1), [unknown('2')]));
    expect(result).toMatchObject({
      groupsCreated: 1,
      discoveryEventsCreated: 1,
    });
    const groups = await prisma.group.findMany({
      where: { course: { btuCourseId: id } },
      orderBy: { btuGroupId: 'asc' },
    });
    expect(groups.map((group) => [group.btuGroupId, group.status])).toEqual([
      ['1', 'FULL'],
      ['2', 'UNKNOWN'],
    ]);
    await service.ingest(observation(id, at(2), [availableGroup('2')]));
    const changes = await prisma.groupStateChange.findMany({
      where: { group: { course: { btuCourseId: id }, btuGroupId: '2' } },
      orderBy: { observedAt: 'asc' },
    });
    expect(
      changes.map((change) => [change.previousStatus, change.status]),
    ).toEqual([
      [null, 'UNKNOWN'],
      ['UNKNOWN', 'AVAILABLE'],
    ]);
  });

  it('scopes the same BTU group ID to each course', async () => {
    const first = courseId();
    const second = courseId();
    await service.ingest(observation(first, at(0), [full('1')]));
    await service.ingest(observation(second, at(0), [availableGroup('1')]));
    const groups = await prisma.group.findMany({
      where: {
        btuGroupId: '1',
        course: { btuCourseId: { in: [first, second] } },
      },
    });
    expect(groups).toHaveLength(2);
    expect(new Set(groups.map((group) => group.courseId)).size).toBe(2);
  });

  it('serializes concurrent identical and out-of-order submissions', async () => {
    const id = courseId();
    const initial = observation(id, at(0), [full('1')]);
    const results = await Promise.all(
      Array.from({ length: 4 }, () => service.ingest(initial)),
    );
    expect(results.reduce((total, item) => total + item.groupsCreated, 0)).toBe(
      1,
    );
    expect(
      await prisma.groupStateChange.count({
        where: { group: { course: { btuCourseId: id } } },
      }),
    ).toBe(1);
    await Promise.all([
      service.ingest(observation(id, at(1), [unknown('1')])),
      service.ingest(observation(id, at(2), [availableGroup('1')])),
    ]);
    const group = await prisma.group.findFirstOrThrow({
      where: { course: { btuCourseId: id } },
    });
    expect(group.status).toBe('AVAILABLE');
    expect(group.lastObservedAt.toISOString()).toBe(at(2));
    expect(
      await prisma.groupStateChange.count({
        where: { groupId: group.id, kind: 'STATUS_CHANGED' },
      }),
    ).toBe(1);
  });
});
