import {
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type {
  CanonicalCourseResponse,
  CourseObservation,
  ObservationIngestionResponse,
} from '@btu-course-watch/contracts';
import { PrismaService } from '../prisma/prisma.service.js';

@Injectable()
export class ObservationsService {
  constructor(private readonly prisma: PrismaService) {}

  async ingest(
    observation: CourseObservation,
  ): Promise<ObservationIngestionResponse> {
    const observedAt = new Date(observation.observedAt);
    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        return await this.prisma.$transaction(
          async (tx) => {
            let course = await tx.course.findUnique({
              where: { btuCourseId: observation.btuCourseId },
            });
            if (!course) {
              course = await tx.course.create({
                data: {
                  btuCourseId: observation.btuCourseId,
                  name: observation.courseName,
                  lastObservedAt: observedAt,
                },
              });
            } else if (observedAt > course.lastObservedAt) {
              await tx.course.updateMany({
                where: { id: course.id, lastObservedAt: { lt: observedAt } },
                data: {
                  lastObservedAt: observedAt,
                  ...(observation.courseName !== null && {
                    name: observation.courseName,
                  }),
                },
              });
            }

            const result: ObservationIngestionResponse = {
              btuCourseId: observation.btuCourseId,
              groupsCreated: 0,
              groupsUpdated: 0,
              groupsSkipped: 0,
              discoveryEventsCreated: 0,
              statusChangesCreated: 0,
            };

            for (const incoming of observation.groups) {
              const existing = await tx.group.findUnique({
                where: {
                  courseId_btuGroupId: {
                    courseId: course.id,
                    btuGroupId: incoming.btuGroupId,
                  },
                },
              });
              if (!existing) {
                await tx.group.create({
                  data: {
                    courseId: course.id,
                    btuGroupId: incoming.btuGroupId,
                    name: incoming.name,
                    capacity: incoming.capacity,
                    status: incoming.status,
                    chooseUrl: incoming.chooseUrl,
                    firstObservedAt: observedAt,
                    lastObservedAt: observedAt,
                    stateChanges: {
                      create: {
                        kind: 'DISCOVERED',
                        status: incoming.status,
                        observedAt,
                      },
                    },
                  },
                });
                result.groupsCreated++;
                result.discoveryEventsCreated++;
                continue;
              }
              if (observedAt <= existing.lastObservedAt) {
                result.groupsSkipped++;
                continue;
              }

              // UNKNOWN cannot demote a previously definitive observation.
              const status =
                incoming.status === 'UNKNOWN' && existing.status !== 'UNKNOWN'
                  ? existing.status
                  : incoming.status;
              const updated = await tx.group.updateMany({
                where: { id: existing.id, lastObservedAt: { lt: observedAt } },
                data: {
                  lastObservedAt: observedAt,
                  status,
                  chooseUrl: incoming.chooseUrl,
                  ...(incoming.name !== null && { name: incoming.name }),
                  ...(incoming.capacity !== null && {
                    capacity: incoming.capacity,
                  }),
                },
              });
              if (updated.count !== 1) {
                result.groupsSkipped++;
                continue;
              }
              result.groupsUpdated++;
              if (status !== existing.status) {
                await tx.groupStateChange.create({
                  data: {
                    groupId: existing.id,
                    kind: 'STATUS_CHANGED',
                    previousStatus: existing.status,
                    status,
                    observedAt,
                  },
                });
                result.statusChangesCreated++;
              }
            }
            return result;
          },
          { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
        );
      } catch (error) {
        if (
          error instanceof Prisma.PrismaClientKnownRequestError &&
          (error.code === 'P2034' || error.code === 'P2002')
        ) {
          continue;
        }
        throw error;
      }
    }
    throw new ServiceUnavailableException(
      'Observation could not be accepted; retry',
    );
  }

  async courseState(btuCourseId: string): Promise<CanonicalCourseResponse> {
    return this.prisma.$transaction(
      async (tx) => {
        const course = await tx.course.findUnique({
          where: { btuCourseId },
          include: {
            groups: { orderBy: { btuGroupId: 'asc' } },
          },
        });
        if (!course) throw new NotFoundException('Course not found');
        const recentChanges = await tx.groupStateChange.findMany({
          where: { group: { courseId: course.id } },
          include: { group: { select: { btuGroupId: true } } },
          orderBy: [{ observedAt: 'desc' }, { id: 'desc' }],
          take: 20,
        });
        return {
          btuCourseId: course.btuCourseId,
          name: course.name,
          lastObservedAt: course.lastObservedAt.toISOString(),
          groups: course.groups.map((group) => ({
            btuGroupId: group.btuGroupId,
            name: group.name,
            capacity: group.capacity,
            status: group.status,
            firstObservedAt: group.firstObservedAt.toISOString(),
            lastObservedAt: group.lastObservedAt.toISOString(),
            chooseUrlPresent: group.chooseUrl !== null,
          })),
          recentChanges: recentChanges.map((change) => ({
            btuGroupId: change.group.btuGroupId,
            kind: change.kind,
            previousStatus: change.previousStatus,
            status: change.status,
            observedAt: change.observedAt.toISOString(),
          })),
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
  }
}
