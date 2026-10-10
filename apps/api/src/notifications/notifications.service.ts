import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type {
  AvailabilityNotification,
  NotificationListResponse,
} from '@btu-course-watch/contracts';
import { z } from 'zod';
import { PrismaService } from '../prisma/prisma.service.js';

const uuid = z.uuid();
const listQuery = z.strictObject({
  cursor: uuid.optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});
const include = {
  group: { include: { course: true } },
  stateChange: true,
} as const;
type NotificationWithRelations = Prisma.NotificationGetPayload<{
  include: typeof include;
}>;

function toResponse(item: NotificationWithRelations): AvailabilityNotification {
  return {
    id: item.id,
    type: item.type,
    createdAt: item.createdAt.toISOString(),
    observedAt: item.stateChange.observedAt.toISOString(),
    readAt: item.readAt?.toISOString() ?? null,
    btuCourseId: item.group.course.btuCourseId,
    courseName: item.group.course.name,
    btuGroupId: item.group.btuGroupId,
    groupName: item.group.name,
  };
}

@Injectable()
export class NotificationsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(
    userId: string,
    query: unknown,
  ): Promise<NotificationListResponse> {
    const parsed = listQuery.safeParse(query);
    if (!parsed.success)
      throw new BadRequestException('Invalid notification query');
    const { cursor, limit } = parsed.data;
    return this.prisma.$transaction(
      async (tx) => {
        if (cursor) {
          const ownedCursor = await tx.notification.findFirst({
            where: { id: cursor, userId },
            select: { id: true },
          });
          if (!ownedCursor)
            throw new BadRequestException('Invalid notification cursor');
        }
        const [rows, unreadCount] = await Promise.all([
          tx.notification.findMany({
            where: { userId },
            include,
            orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
            take: limit + 1,
            ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
          }),
          tx.notification.count({ where: { userId, readAt: null } }),
        ]);
        const hasMore = rows.length > limit;
        const page = rows.slice(0, limit);
        return {
          items: page.map(toResponse),
          unreadCount,
          nextCursor: hasMore ? page.at(-1)!.id : null,
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
  }

  async markRead(userId: string, id: string): Promise<void> {
    if (!uuid.safeParse(id).success)
      throw new BadRequestException('Invalid notification identifier');
    await this.prisma.notification.updateMany({
      where: { id, userId, readAt: null },
      data: { readAt: new Date() },
    });
  }

  async markAllRead(userId: string): Promise<void> {
    await this.prisma.notification.updateMany({
      where: { userId, readAt: null },
      data: { readAt: new Date() },
    });
  }
}
