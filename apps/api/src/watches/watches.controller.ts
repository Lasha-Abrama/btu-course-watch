import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  HttpCode,
  Param,
  Put,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBody,
  ApiCookieAuth,
  ApiForbiddenResponse,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import type { WatchResponse } from '@btu-course-watch/contracts';
import { CurrentUser } from '../auth/current-user.decorator.js';
import { SessionGuard } from '../auth/session.guard.js';
import type { CurrentUser as CurrentUserType } from '../auth/session.service.js';
import { WatchesService } from './watches.service.js';

export const watchCreateBody = {
  schema: {
    type: 'object',
    additionalProperties: false,
    required: ['btuCourseId', 'btuGroupId'],
    properties: {
      btuCourseId: { type: 'string', minLength: 1, maxLength: 255 },
      btuGroupId: { type: 'string', minLength: 1, maxLength: 255 },
    },
  },
} satisfies Parameters<typeof ApiBody>[0];

@ApiTags('watches — trusted web session')
@ApiCookieAuth('accessCookie')
@ApiUnauthorizedResponse({ description: 'Application session required.' })
@UseGuards(SessionGuard)
@Controller('watches')
export class WatchesController {
  constructor(private readonly watches: WatchesService) {}

  @Get()
  @Header('Cache-Control', 'no-store')
  @ApiOperation({
    summary: 'List only the current user’s watched canonical groups',
  })
  @ApiOkResponse({
    description:
      'User-owned watches joined to last-known shared Group state; no Choose URLs.',
  })
  list(@CurrentUser() user: CurrentUserType): Promise<WatchResponse[]> {
    return this.watches.list(user.id);
  }

  @Put()
  @Header('Cache-Control', 'no-store')
  @ApiOperation({
    summary: 'Idempotently watch one previously observed course/group pair',
  })
  @ApiBody(watchCreateBody)
  @ApiOkResponse({
    description:
      'The single user-owned watch and current canonical group metadata.',
  })
  @ApiBadRequestResponse({
    description: 'Malformed course/group identifiers or unexpected fields.',
  })
  @ApiNotFoundResponse({
    description: 'The canonical course/group has not been observed.',
  })
  @ApiForbiddenResponse({ description: 'Browser origin is not trusted.' })
  create(
    @CurrentUser() user: CurrentUserType,
    @Body() body: unknown,
  ): Promise<WatchResponse> {
    return this.watches.create(user.id, body);
  }

  @Delete(':watchId')
  @HttpCode(204)
  @Header('Cache-Control', 'no-store')
  @ApiOperation({
    summary:
      'Idempotently remove one owned watch; other users’ IDs are not revealed',
  })
  @ApiNoContentResponse({ description: 'Removed or already absent.' })
  @ApiBadRequestResponse({ description: 'Invalid watch UUID.' })
  @ApiForbiddenResponse({ description: 'Browser origin is not trusted.' })
  remove(
    @CurrentUser() user: CurrentUserType,
    @Param('watchId') id: string,
  ): Promise<void> {
    return this.watches.remove(user.id, id);
  }
}
