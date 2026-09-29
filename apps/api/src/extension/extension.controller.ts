import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiBody,
  ApiCookieAuth,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiHeader,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import type { Request } from 'express';
import type { ObservationIngestionResponse } from '@btu-course-watch/contracts';
import { z } from 'zod';
import { CurrentUser } from '../auth/current-user.decorator.js';
import { SessionGuard } from '../auth/session.guard.js';
import type { CurrentUser as CurrentUserType } from '../auth/session.service.js';
import { parseObservationPayload } from '../observations/observation.validation.js';
import { observationBody } from '../observations/observations.controller.js';
import { ObservationsService } from '../observations/observations.service.js';
import { ExtensionAuthService } from './extension-auth.service.js';
import {
  ExtensionCredentialGuard,
  ExtensionTransportGuard,
} from './extension.guards.js';
import type { ExtensionRequest } from './extension.guards.js';

const uuid = z.uuid();
const startSchema = z.strictObject({
  installationId: uuid,
  challengeHash: z.string().regex(/^[0-9a-f]{64}$/),
});
const exchangeSchema = z.strictObject({
  verifier: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
});

function requestId(value: string): string {
  if (!uuid.safeParse(value).success)
    throw new BadRequestException('Invalid extension request');
  return value;
}

@ApiTags('extension linking — trusted web session')
@ApiCookieAuth('accessCookie')
@ApiUnauthorizedResponse({ description: 'Application session required.' })
@UseGuards(SessionGuard)
@Controller('extension')
export class ExtensionWebController {
  constructor(private readonly authorizations: ExtensionAuthService) {}

  @Get('link-requests/:requestId')
  @Header('Cache-Control', 'no-store')
  @ApiOperation({
    summary: 'Review a pending extension request before approval',
  })
  @ApiOkResponse({
    description: 'Request ID, pairing code, expiry, and approval status only.',
  })
  async requestInfo(
    @Param('requestId') id: string,
    @CurrentUser() user: CurrentUserType,
  ) {
    return this.authorizations.approvalInfo(requestId(id), user.id);
  }

  @Post('link-requests/:requestId/approve')
  @HttpCode(204)
  @Header('Cache-Control', 'no-store')
  @ApiOperation({ summary: 'Explicitly authorize this extension installation' })
  @ApiForbiddenResponse({ description: 'Browser origin is not trusted.' })
  async approve(
    @Param('requestId') id: string,
    @Body() body: unknown,
    @CurrentUser() user: CurrentUserType,
  ): Promise<void> {
    if (
      !body ||
      typeof body !== 'object' ||
      Array.isArray(body) ||
      Object.keys(body).length !== 0
    )
      throw new BadRequestException('Invalid extension request');
    await this.authorizations.approve(requestId(id), user.id);
  }

  @Get('authorizations')
  @Header('Cache-Control', 'no-store')
  @ApiOperation({
    summary:
      'List active extension observation authorizations owned by this user',
  })
  @ApiOkResponse({
    description: 'Authorization IDs and timestamps; never credentials.',
  })
  list(@CurrentUser() user: CurrentUserType) {
    return this.authorizations.list(user.id);
  }

  @Post('authorizations/:authorizationId/revoke')
  @HttpCode(204)
  @Header('Cache-Control', 'no-store')
  @ApiOperation({
    summary: 'Revoke one owned extension observation authorization',
  })
  @ApiForbiddenResponse({ description: 'Browser origin is not trusted.' })
  async revoke(
    @Param('authorizationId') id: string,
    @Body() body: unknown,
    @CurrentUser() user: CurrentUserType,
  ): Promise<void> {
    if (
      !body ||
      typeof body !== 'object' ||
      Array.isArray(body) ||
      Object.keys(body).length !== 0
    )
      throw new BadRequestException('Invalid extension request');
    await this.authorizations.revoke(user.id, requestId(id));
  }
}

@ApiTags('extension — scoped credential')
@ApiHeader({
  name: 'X-BCW-Extension-Id',
  description: 'Chrome runtime.id for this installation.',
})
@ApiForbiddenResponse({
  description: 'Invalid extension transport or browser origin.',
})
@UseGuards(ExtensionTransportGuard)
@Controller('extension')
export class ExtensionClientController {
  constructor(
    private readonly authorizations: ExtensionAuthService,
    private readonly observations: ObservationsService,
  ) {}

  @Post('link-requests')
  @Header('Cache-Control', 'no-store')
  @ApiOperation({
    summary:
      'Start a five-minute extension link request; no web cookie is accepted',
  })
  @ApiBody({
    schema: {
      type: 'object',
      required: ['installationId', 'challengeHash'],
      additionalProperties: false,
      properties: {
        installationId: { type: 'string', format: 'uuid' },
        challengeHash: { type: 'string', minLength: 64, maxLength: 64 },
      },
    },
  })
  @ApiBadRequestResponse({ description: 'Invalid request.' })
  @ApiCreatedResponse({
    description:
      'Opaque request ID and five-minute expiry, never a credential.',
  })
  async start(@Body() body: unknown, @Req() request: Request) {
    const parsed = startSchema.safeParse(body);
    if (!parsed.success)
      throw new BadRequestException('Invalid extension request');
    return this.authorizations.start(
      parsed.data.installationId,
      request.headers['x-bcw-extension-id'] as string,
      parsed.data.challengeHash,
    );
  }

  @Post('link-requests/:requestId/exchange')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  @ApiOperation({
    summary:
      'Exchange the approved one-time verifier for an observation-only credential',
  })
  @ApiBody({
    schema: {
      type: 'object',
      required: ['verifier'],
      additionalProperties: false,
      properties: {
        verifier: { type: 'string', minLength: 43, maxLength: 43 },
      },
    },
  })
  @ApiUnauthorizedResponse({
    description: 'Invalid, expired, mismatched, or used request.',
  })
  @ApiOkResponse({
    description:
      'Pending approval or one observation-only credential after one-time exchange.',
  })
  async exchange(
    @Param('requestId') id: string,
    @Body() body: unknown,
    @Req() request: Request,
  ) {
    const parsed = exchangeSchema.safeParse(body);
    if (!parsed.success)
      throw new BadRequestException('Invalid extension request');
    return this.authorizations.exchange(
      requestId(id),
      parsed.data.verifier,
      request.headers['x-bcw-extension-id'] as string,
    );
  }

  @Get('status')
  @UseGuards(ExtensionCredentialGuard)
  @ApiBearerAuth('extensionCredential')
  @Header('Cache-Control', 'no-store')
  @ApiOperation({
    summary: 'Check whether the observation-only credential remains valid',
  })
  @ApiUnauthorizedResponse({
    description: 'Invalid, expired, or revoked credential.',
  })
  status(@Req() request: ExtensionRequest) {
    return {
      linked: true,
      expiresAt: request.extensionIdentity!.expiresAt.toISOString(),
    };
  }

  @Post('observations')
  @UseGuards(ExtensionCredentialGuard)
  @ApiBearerAuth('extensionCredential')
  @Header('Cache-Control', 'no-store')
  @ApiOperation({
    summary:
      'Submit a structured observation with the scoped extension credential',
    description:
      'Same strict CourseObservation body as POST /api/v1/observations; no raw HTML or BTU credentials. Reuses the canonical ingestion service.',
  })
  @ApiUnauthorizedResponse({
    description: 'Invalid, expired, or revoked credential.',
  })
  @ApiBody(observationBody)
  @ApiBadRequestResponse({ description: 'Invalid structured observation.' })
  @ApiCreatedResponse({
    description:
      'Sanitized created, updated, skipped, and history-event counts.',
  })
  async ingest(@Body() body: unknown): Promise<ObservationIngestionResponse> {
    const observation = parseObservationPayload(body);
    if (!observation)
      throw new BadRequestException('Invalid structured observation');
    return this.observations.ingest(observation);
  }
}
