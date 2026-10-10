import {
  Controller,
  Get,
  Header,
  HttpCode,
  Param,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiCookieAuth,
  ApiForbiddenResponse,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiQuery,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import type { NotificationListResponse } from '@btu-course-watch/contracts';
import { CurrentUser } from '../auth/current-user.decorator.js';
import { SessionGuard } from '../auth/session.guard.js';
import type { CurrentUser as CurrentUserType } from '../auth/session.service.js';
import { NotificationsService } from './notifications.service.js';

@ApiTags('notifications — trusted web session')
@ApiCookieAuth('accessCookie')
@ApiUnauthorizedResponse({ description: 'Application session required.' })
@UseGuards(SessionGuard)
@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @Get()
  @Header('Cache-Control', 'no-store')
  @ApiOperation({
    summary: 'List current user’s historical availability alerts',
  })
  @ApiQuery({ name: 'cursor', required: false, type: String })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  @ApiOkResponse({
    description:
      'Newest-first, owner-scoped page and unread count; no Choose URLs.',
  })
  @ApiBadRequestResponse({ description: 'Invalid pagination query or cursor.' })
  list(
    @CurrentUser() user: CurrentUserType,
    @Query() query: unknown,
  ): Promise<NotificationListResponse> {
    return this.notifications.list(user.id, query);
  }

  @Put('read-all')
  @HttpCode(204)
  @Header('Cache-Control', 'no-store')
  @ApiOperation({ summary: 'Idempotently mark all owned alerts as read' })
  @ApiNoContentResponse({ description: 'All owned notifications are read.' })
  @ApiForbiddenResponse({ description: 'Browser origin is not trusted.' })
  markAllRead(@CurrentUser() user: CurrentUserType): Promise<void> {
    return this.notifications.markAllRead(user.id);
  }

  @Put(':notificationId/read')
  @HttpCode(204)
  @Header('Cache-Control', 'no-store')
  @ApiOperation({ summary: 'Idempotently mark one owned alert as read' })
  @ApiNoContentResponse({
    description: 'Read or already absent; other users’ IDs are not revealed.',
  })
  @ApiBadRequestResponse({ description: 'Invalid notification UUID.' })
  @ApiForbiddenResponse({ description: 'Browser origin is not trusted.' })
  markRead(
    @CurrentUser() user: CurrentUserType,
    @Param('notificationId') id: string,
  ): Promise<void> {
    return this.notifications.markRead(user.id, id);
  }
}
