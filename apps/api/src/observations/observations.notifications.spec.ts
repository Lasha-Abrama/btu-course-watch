import { Prisma } from '@prisma/client';
import type { CourseObservation } from '@btu-course-watch/contracts';
import { PrismaService } from '../prisma/prisma.service.js';
import { ObservationsService } from './observations.service.js';

const observedAt = new Date('2026-10-04T12:00:00.000Z');
const observation = (
  status: 'AVAILABLE' | 'FULL' | 'UNKNOWN',
): CourseObservation => ({
  btuCourseId: '665',
  courseName: null,
  observedAt: observedAt.toISOString(),
  groups: [
    {
      btuGroupId: '13344',
      name: 'Group 1',
      capacity: 27,
      status,
      chooseUrl:
        status === 'AVAILABLE'
          ? 'https://classroom.btu.edu.ge/ge/student/me/choose/13435'
          : null,
    },
  ],
});

function setup(
  previousStatus: 'AVAILABLE' | 'FULL' | 'UNKNOWN',
  lastObservedAt = new Date(observedAt.getTime() - 1000),
  owners = ['user-1', 'user-2'],
  verifiedOwners = owners,
) {
  const tx = {
    course: {
      findUnique: vi.fn(async () => ({ id: 'course-1', lastObservedAt })),
      updateMany: vi.fn(async () => ({ count: 1 })),
    },
    group: {
      findUnique: vi.fn(async () => ({
        id: 'group-1',
        status: previousStatus,
        lastObservedAt,
      })),
      updateMany: vi.fn(async () => ({ count: 1 })),
      create: vi.fn(async () => ({ id: 'group-1' })),
    },
    groupStateChange: {
      create: vi.fn(async () => ({ id: 'change-1' })),
    },
    watch: {
      findMany: vi.fn(async () =>
        owners.map((userId) => ({
          userId,
          user: {
            emailVerifiedAt: verifiedOwners.includes(userId)
              ? new Date()
              : null,
          },
        })),
      ),
    },
    notification: {
      createMany: vi.fn(async () => ({ count: owners.length })),
      findMany: vi.fn(async (args: { where: { userId: { in: string[] } } }) =>
        args.where.userId.in.map((userId) => ({
          id: `notification-${userId}`,
        })),
      ),
    },
    emailDelivery: {
      createMany: vi.fn(async () => ({ count: verifiedOwners.length })),
    },
  };
  const prisma = {
    $transaction: vi.fn(
      async (
        work: (client: typeof tx) => Promise<unknown>,
        options: unknown,
      ) => {
        expect(options).toEqual({
          isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        });
        return work(tx);
      },
    ),
  };
  const service = new ObservationsService(prisma as unknown as PrismaService);
  return { service, tx, prisma };
}

describe('availability notification transaction hook', () => {
  it.each(['FULL', 'UNKNOWN'] as const)(
    'creates one row per owner for %s → AVAILABLE inside the serializable transaction',
    async (previous) => {
      const { service, tx } = setup(previous);
      expect(await service.ingest(observation('AVAILABLE'))).toMatchObject({
        statusChangesCreated: 1,
      });
      expect(tx.groupStateChange.create).toHaveBeenCalledWith({
        data: {
          groupId: 'group-1',
          kind: 'STATUS_CHANGED',
          previousStatus: previous,
          status: 'AVAILABLE',
          observedAt,
        },
      });
      expect(tx.notification.createMany).toHaveBeenCalledWith({
        data: [
          {
            userId: 'user-1',
            groupId: 'group-1',
            stateChangeId: 'change-1',
            type: 'GROUP_AVAILABLE',
          },
          {
            userId: 'user-2',
            groupId: 'group-1',
            stateChangeId: 'change-1',
            type: 'GROUP_AVAILABLE',
          },
        ],
        skipDuplicates: true,
      });
      expect(tx.emailDelivery.createMany).toHaveBeenCalledWith({
        data: [
          { notificationId: 'notification-user-1' },
          { notificationId: 'notification-user-2' },
        ],
        skipDuplicates: true,
      });
    },
  );

  it('does not alert when already AVAILABLE, when UNKNOWN preserves AVAILABLE, or when stale', async () => {
    for (const status of ['AVAILABLE', 'UNKNOWN'] as const) {
      const { service, tx } = setup('AVAILABLE');
      await service.ingest(observation(status));
      expect(tx.notification.createMany).not.toHaveBeenCalled();
      expect(tx.emailDelivery.createMany).not.toHaveBeenCalled();
      expect(tx.groupStateChange.create).not.toHaveBeenCalled();
    }
    const { service, tx } = setup('FULL', observedAt);
    expect((await service.ingest(observation('AVAILABLE'))).groupsSkipped).toBe(
      1,
    );
    expect(tx.notification.createMany).not.toHaveBeenCalled();
    expect(tx.emailDelivery.createMany).not.toHaveBeenCalled();
  });

  it('does not write notification rows when no one watches the transitioning group', async () => {
    const { service, tx } = setup('FULL', undefined, []);
    await service.ingest(observation('AVAILABLE'));
    expect(tx.groupStateChange.create).toHaveBeenCalledOnce();
    expect(tx.notification.createMany).not.toHaveBeenCalled();
  });

  it('does not alert on first discovery even when the initial state is AVAILABLE', async () => {
    const { service, tx } = setup('FULL');
    tx.group.findUnique.mockResolvedValueOnce(null as never);
    const result = await service.ingest(observation('AVAILABLE'));
    expect(result).toMatchObject({
      groupsCreated: 1,
      discoveryEventsCreated: 1,
      statusChangesCreated: 0,
    });
    expect(tx.group.create).toHaveBeenCalledOnce();
    expect(tx.notification.createMany).not.toHaveBeenCalled();
    expect(tx.watch.findMany).not.toHaveBeenCalled();
    expect(tx.emailDelivery.createMany).not.toHaveBeenCalled();
  });

  it('keeps in-app alerts for unverified owners but queues email only for verified owners', async () => {
    const { service, tx } = setup(
      'FULL',
      undefined,
      ['user-1', 'user-2'],
      ['user-1'],
    );
    await service.ingest(observation('AVAILABLE'));
    expect(tx.notification.createMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.arrayContaining([
          expect.objectContaining({ userId: 'user-2' }),
        ]),
      }),
    );
    expect(tx.emailDelivery.createMany).toHaveBeenCalledWith({
      data: [{ notificationId: 'notification-user-1' }],
      skipDuplicates: true,
    });
  });

  it('retries a serializable conflict so failed attempts cannot commit an alert alone', async () => {
    const { service, prisma, tx } = setup('FULL');
    prisma.$transaction.mockRejectedValueOnce(
      new Prisma.PrismaClientKnownRequestError('Serialization conflict', {
        code: 'P2034',
        clientVersion: '6.19.3',
      }),
    );
    await service.ingest(observation('AVAILABLE'));
    expect(prisma.$transaction).toHaveBeenCalledTimes(2);
    expect(tx.notification.createMany).toHaveBeenCalledOnce();
  });
});
