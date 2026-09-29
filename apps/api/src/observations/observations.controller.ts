import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Header,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBody,
  ApiCookieAuth,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import type {
  CanonicalCourseResponse,
  ObservationIngestionResponse,
} from '@btu-course-watch/contracts';
import { SessionGuard } from '../auth/session.guard.js';
import {
  isExternalId,
  parseObservationPayload,
} from './observation.validation.js';
import { ObservationsService } from './observations.service.js';

export const observationBody = {
  schema: {
    type: 'object',
    additionalProperties: false,
    required: ['btuCourseId', 'observedAt', 'courseName', 'groups'],
    properties: {
      btuCourseId: { type: 'string', maxLength: 255 },
      observedAt: { type: 'string', format: 'date-time' },
      courseName: { type: 'string', nullable: true, maxLength: 500 },
      groups: {
        type: 'array',
        minItems: 1,
        maxItems: 100,
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['btuGroupId', 'name', 'capacity', 'status', 'chooseUrl'],
          properties: {
            btuGroupId: { type: 'string', maxLength: 255 },
            name: { type: 'string', nullable: true, maxLength: 500 },
            capacity: { type: 'integer', nullable: true, minimum: 0 },
            status: { type: 'string', enum: ['AVAILABLE', 'FULL', 'UNKNOWN'] },
            chooseUrl: { type: 'string', nullable: true, maxLength: 2048 },
          },
        },
      },
    },
  },
} satisfies Parameters<typeof ApiBody>[0];

@ApiTags('observations')
@ApiCookieAuth('accessCookie')
@ApiUnauthorizedResponse({
  description: 'A valid application session is required.',
})
@UseGuards(SessionGuard)
@Controller()
export class ObservationsController {
  constructor(private readonly observations: ObservationsService) {}

  @Post('observations')
  @Header('Cache-Control', 'no-store')
  @ApiOperation({
    summary: 'Ingest one structured BTU Classroom Groups-page observation',
    description:
      'Accepts structured data only, never BTU HTML or credentials. Requires the application access cookie and the configured trusted origin for browser requests.',
  })
  @ApiBody(observationBody)
  @ApiCreatedResponse({
    description: 'Sanitized counts of accepted group updates and events.',
    schema: {
      type: 'object',
      required: [
        'btuCourseId',
        'groupsCreated',
        'groupsUpdated',
        'groupsSkipped',
        'discoveryEventsCreated',
        'statusChangesCreated',
      ],
      properties: {
        btuCourseId: { type: 'string' },
        groupsCreated: { type: 'integer' },
        groupsUpdated: { type: 'integer' },
        groupsSkipped: { type: 'integer' },
        discoveryEventsCreated: { type: 'integer' },
        statusChangesCreated: { type: 'integer' },
      },
    },
  })
  @ApiBadRequestResponse({ description: 'Invalid structured observation.' })
  @ApiForbiddenResponse({ description: 'Request origin is not permitted.' })
  async ingest(@Body() body: unknown): Promise<ObservationIngestionResponse> {
    const observation = parseObservationPayload(body);
    if (!observation)
      throw new BadRequestException('Invalid structured observation');
    return this.observations.ingest(observation);
  }

  @Get('courses/:btuCourseId')
  @Header('Cache-Control', 'no-store')
  @ApiOperation({
    summary: 'Read shared canonical state and up to 20 recent group events',
    description:
      'Availability is last-known state, not a live guarantee. No submitting-user data or Choose URLs are returned.',
  })
  @ApiParam({
    name: 'btuCourseId',
    description: 'Opaque BTU course identifier.',
  })
  @ApiOkResponse({
    description: 'Canonical course/groups with bounded recent history.',
    schema: {
      type: 'object',
      required: [
        'btuCourseId',
        'name',
        'lastObservedAt',
        'groups',
        'recentChanges',
      ],
      properties: {
        btuCourseId: { type: 'string' },
        name: { type: 'string', nullable: true },
        lastObservedAt: { type: 'string', format: 'date-time' },
        groups: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              btuGroupId: { type: 'string' },
              name: { type: 'string', nullable: true },
              capacity: { type: 'integer', nullable: true },
              status: {
                type: 'string',
                enum: ['AVAILABLE', 'FULL', 'UNKNOWN'],
              },
              firstObservedAt: { type: 'string', format: 'date-time' },
              lastObservedAt: { type: 'string', format: 'date-time' },
              chooseUrlPresent: { type: 'boolean' },
            },
          },
        },
        recentChanges: {
          type: 'array',
          maxItems: 20,
          items: {
            type: 'object',
            properties: {
              btuGroupId: { type: 'string' },
              kind: { type: 'string', enum: ['DISCOVERED', 'STATUS_CHANGED'] },
              previousStatus: {
                type: 'string',
                enum: ['AVAILABLE', 'FULL', 'UNKNOWN'],
                nullable: true,
              },
              status: {
                type: 'string',
                enum: ['AVAILABLE', 'FULL', 'UNKNOWN'],
              },
              observedAt: { type: 'string', format: 'date-time' },
            },
          },
        },
      },
    },
  })
  @ApiBadRequestResponse({ description: 'Invalid BTU course identifier.' })
  @ApiNotFoundResponse({
    description: 'No course has been observed with this identifier.',
  })
  async courseState(
    @Param('btuCourseId') btuCourseId: string,
  ): Promise<CanonicalCourseResponse> {
    if (!isExternalId(btuCourseId))
      throw new BadRequestException('Invalid BTU course identifier');
    return this.observations.courseState(btuCourseId);
  }
}
