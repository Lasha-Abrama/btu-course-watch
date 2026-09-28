import {
  BadRequestException,
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
} from '@nestjs/common';
import {
  ApiAcceptedResponse,
  ApiBadRequestResponse,
  ApiBody,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import type {
  AuthAcceptedResponse,
  EmailVerifiedResponse,
} from '@btu-course-watch/contracts';
import { AuthService } from './auth.service.js';
import {
  registrationSchema,
  resendVerificationSchema,
  verifyEmailSchema,
} from './auth.validation.js';

const ACCEPTED_RESPONSE = {
  message: 'If eligible, a verification email will be sent.',
} as const satisfies AuthAcceptedResponse;

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('register')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({ summary: 'Register with a BTU email address' })
  @ApiBody({
    schema: {
      type: 'object',
      required: ['email', 'password'],
      additionalProperties: false,
      properties: {
        email: {
          type: 'string',
          format: 'email',
          example: 'student@btu.edu.ge',
        },
        password: {
          type: 'string',
          format: 'password',
          minLength: 12,
          maxLength: 128,
          description:
            'Use 12–128 characters with three character types, or a passphrase of at least 20 characters and three words of at least three characters each.',
        },
      },
    },
  })
  @ApiAcceptedResponse({
    description: 'The request was accepted without disclosing account status.',
    schema: { example: ACCEPTED_RESPONSE },
  })
  @ApiBadRequestResponse({ description: 'Invalid BTU email or password.' })
  async register(@Body() body: unknown): Promise<AuthAcceptedResponse> {
    const result = registrationSchema.safeParse(body);
    if (!result.success) {
      throw new BadRequestException('Invalid BTU email or password');
    }

    await this.authService.register(result.data.email, result.data.password);
    return ACCEPTED_RESPONSE;
  }

  @Post('verify-email')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Verify an email with a one-time token' })
  @ApiBody({
    schema: {
      type: 'object',
      required: ['token'],
      additionalProperties: false,
      properties: {
        token: {
          type: 'string',
          description: 'Token from the verification email.',
        },
      },
    },
  })
  @ApiOkResponse({
    description: 'Email verified.',
    schema: { example: { message: 'Email verified.' } },
  })
  @ApiBadRequestResponse({
    description: 'Invalid or expired verification token.',
  })
  async verifyEmail(@Body() body: unknown): Promise<EmailVerifiedResponse> {
    const result = verifyEmailSchema.safeParse(body);
    if (!result.success) {
      throw new BadRequestException('Invalid or expired verification token');
    }

    await this.authService.verifyEmail(result.data.token);
    return { message: 'Email verified.' };
  }

  @Post('resend-verification')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({ summary: 'Request a new email verification token' })
  @ApiBody({
    schema: {
      type: 'object',
      required: ['email'],
      additionalProperties: false,
      properties: {
        email: {
          type: 'string',
          format: 'email',
          example: 'student@btu.edu.ge',
        },
      },
    },
  })
  @ApiAcceptedResponse({
    description: 'The request was accepted without disclosing account status.',
    schema: { example: ACCEPTED_RESPONSE },
  })
  @ApiBadRequestResponse({ description: 'Invalid BTU email.' })
  async resendVerification(
    @Body() body: unknown,
  ): Promise<AuthAcceptedResponse> {
    const result = resendVerificationSchema.safeParse(body);
    if (!result.success) {
      throw new BadRequestException('Invalid BTU email');
    }

    await this.authService.resendVerification(result.data.email);
    return ACCEPTED_RESPONSE;
  }
}
