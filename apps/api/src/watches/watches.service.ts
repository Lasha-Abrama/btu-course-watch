import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type {
  WatchCreateRequest,
  WatchResponse,
} from '@btu-course-watch/contracts';
import { z } from 'zod';
import { PrismaService } from '../prisma/prisma.service.js';

const externalId = z
  .string()
  .min(1)
  .max(255)
  .regex(/^[A-Za-z0-9_-]+$/);
const createSchema = z.strictObject({
  btuCourseId: externalId,
  btuGroupId: externalId,
});
const uuid = z.uuid();

const include = { group: { include: { course: true } } } as const;
type WatchWithGroup = Prisma.WatchGetPayload<{ include: typeof include }>;

function response(watch: WatchWithGroup): WatchResponse {
  return {
    id: watch.id,
    createdAt: watch.createdAt.toISOString(),
    btuCourseId: watch.group.course.btuCourseId,
    courseName: watch.group.course.name,
    btuGroupId: watch.group.btuGroupId,
    groupName: watch.group.name,
    capacity: watch.group.capacity,
    status: watch.group.status,
    lastObservedAt: watch.group.lastObservedAt.toISOString(),
  };
}

@Injectable()
export class WatchesService {
  constructor(private readonly prisma: PrismaService) {}

  async list(userId: string): Promise<WatchResponse[]> {
    const watches = await this.prisma.watch.findMany({
      where: { userId },
      include,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    });
    return watches.map(response);
  }

  async create(userId: string, body: unknown): Promise<WatchResponse> {
    const parsed = createSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException('Invalid watch request');
    const { btuCourseId, btuGroupId }: WatchCreateRequest = parsed.data;
    const group = await this.prisma.group.findFirst({
      where: { btuGroupId, course: { btuCourseId } },
      select: { id: true },
    });
    if (!group) throw new NotFoundException('Group has not been observed');
    try {
      // PostgreSQL ON CONFLICT keeps simultaneous retries to one logical watch.
      await this.prisma.watch.createMany({
        data: [{ userId, groupId: group.id }],
        skipDuplicates: true,
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2003'
      )
        throw new NotFoundException('Group has not been observed');
      throw error;
    }
    const watch = await this.prisma.watch.findUniqueOrThrow({
      where: { userId_groupId: { userId, groupId: group.id } },
      include,
    });
    return response(watch);
  }

  async remove(userId: string, watchId: string): Promise<void> {
    if (!uuid.safeParse(watchId).success)
      throw new BadRequestException('Invalid watch identifier');
    await this.prisma.watch.deleteMany({ where: { id: watchId, userId } });
  }
}
