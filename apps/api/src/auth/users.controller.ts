import { Controller, Get, Header, UseGuards } from '@nestjs/common';
import {
  ApiCookieAuth,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import type { CurrentUserResponse } from '@btu-course-watch/contracts';
import { CurrentUser } from './current-user.decorator.js';
import { SessionGuard } from './session.guard.js';
import type { CurrentUser as CurrentUserType } from './session.service.js';

@ApiTags('users')
@Controller('users')
export class UsersController {
  @Get('me')
  @UseGuards(SessionGuard)
  @Header('Cache-Control', 'no-store')
  @ApiCookieAuth('accessCookie')
  @ApiOperation({ summary: 'Get the current BTU Course Watch user' })
  @ApiOkResponse({
    schema: {
      example: {
        id: 'uuid',
        email: 'student@btu.edu.ge',
        emailVerifiedAt: '2026-09-28T00:00:00.000Z',
      },
    },
  })
  @ApiUnauthorizedResponse({
    description: 'Missing, invalid, expired, or revoked application session.',
  })
  me(@CurrentUser() user: CurrentUserType): CurrentUserResponse {
    return {
      id: user.id,
      email: user.email,
      emailVerifiedAt: user.emailVerifiedAt.toISOString(),
    };
  }
}
