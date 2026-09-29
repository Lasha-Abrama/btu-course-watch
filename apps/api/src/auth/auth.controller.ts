import {
  BadRequestException,
  Body,
  Controller,
  Header,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  Res,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request, Response } from 'express';
import {
  ApiAcceptedResponse,
  ApiBadRequestResponse,
  ApiBody,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
  ApiForbiddenResponse,
  ApiCookieAuth,
  ApiNoContentResponse,
} from '@nestjs/swagger';
import type {
  AuthAcceptedResponse,
  EmailVerifiedResponse,
  PasswordResetAcceptedResponse,
  PasswordResetResponse,
} from '@btu-course-watch/contracts';
import { AuthService } from './auth.service.js';
import { PasswordResetService } from './password-reset.service.js';
import {
  forgotPasswordSchema,
  registrationSchema,
  loginSchema,
  resendVerificationSchema,
  resetPasswordSchema,
  verifyEmailSchema,
} from './auth.validation.js';
import {
  clearSessionCookies,
  getSessionCookies,
  setSessionCookies,
} from './session.cookies.js';
import { SessionService } from './session.service.js';

const ACCEPTED_RESPONSE = {
  message: 'If eligible, a verification email will be sent.',
} as const satisfies AuthAcceptedResponse;
const RESET_ACCEPTED_RESPONSE = {
  message: 'If eligible, a password reset email will be sent.',
} as const satisfies PasswordResetAcceptedResponse;

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly passwordReset: PasswordResetService,
    private readonly sessions: SessionService,
    private readonly config: ConfigService,
  ) {}

  @Post('login')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Log in with a verified BTU Course Watch account' })
  @ApiBody({
    schema: {
      type: 'object',
      required: ['email', 'password'],
      additionalProperties: false,
      properties: {
        email: { type: 'string', format: 'email' },
        password: { type: 'string', format: 'password' },
      },
    },
  })
  @ApiUnauthorizedResponse({
    description: 'Invalid credentials or account state.',
  })
  @ApiNoContentResponse({
    description:
      'Logged in; access and refresh tokens set as HttpOnly cookies.',
  })
  @ApiForbiddenResponse({ description: 'Request origin is not permitted.' })
  async login(@Body() body: unknown, @Res() response: Response): Promise<void> {
    const result = loginSchema.safeParse(body);
    if (!result.success) throw new UnauthorizedException('Invalid credentials');
    const tokens = await this.authService.login(
      result.data.email,
      result.data.password,
    );
    setSessionCookies(response, this.config, tokens);
    response.status(HttpStatus.NO_CONTENT).send();
  }

  @Post('refresh')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Rotate the application refresh token and renew access',
  })
  @ApiCookieAuth('refreshCookie')
  @ApiNoContentResponse({
    description: 'Tokens rotated and set as HttpOnly cookies.',
  })
  @ApiUnauthorizedResponse({
    description: 'Missing, invalid, expired, revoked, or reused refresh token.',
  })
  @ApiForbiddenResponse({ description: 'Request origin is not permitted.' })
  async refresh(
    @Req() request: Request,
    @Res() response: Response,
  ): Promise<void> {
    const tokens = await this.sessions.refresh(
      getSessionCookies(request).refreshToken,
    );
    setSessionCookies(response, this.config, tokens);
    response.status(HttpStatus.NO_CONTENT).send();
  }

  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiCookieAuth('refreshCookie')
  @ApiNoContentResponse({
    description:
      'Session revoked where present; authentication cookies cleared.',
  })
  @ApiOperation({
    summary: 'Revoke the current application session and clear cookies',
  })
  @ApiForbiddenResponse({ description: 'Request origin is not permitted.' })
  async logout(
    @Req() request: Request,
    @Res() response: Response,
  ): Promise<void> {
    const { refreshToken, accessToken } = getSessionCookies(request);
    await this.sessions.revoke(refreshToken, accessToken);
    clearSessionCookies(response, this.config);
    response.status(HttpStatus.NO_CONTENT).send();
  }

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

  @Post('forgot-password')
  @HttpCode(HttpStatus.ACCEPTED)
  @Header('Cache-Control', 'no-store')
  @ApiOperation({
    summary: 'Request a password reset email',
    description:
      'The response does not disclose whether a local-password account exists. Eligible verified accounts receive a 30-minute one-time link; requests are limited to one email per minute per account.',
  })
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
    description: 'Accepted without disclosing account status.',
    schema: { example: RESET_ACCEPTED_RESPONSE },
  })
  @ApiBadRequestResponse({ description: 'Invalid BTU email.' })
  @ApiForbiddenResponse({ description: 'Request origin is not permitted.' })
  async forgotPassword(
    @Body() body: unknown,
  ): Promise<PasswordResetAcceptedResponse> {
    const result = forgotPasswordSchema.safeParse(body);
    if (!result.success) throw new BadRequestException('Invalid BTU email');
    await this.passwordReset.requestReset(result.data.email);
    return RESET_ACCEPTED_RESPONSE;
  }

  @Post('reset-password')
  @HttpCode(HttpStatus.OK)
  @Header('Cache-Control', 'no-store')
  @ApiOperation({
    summary: 'Set a new password using a one-time reset token',
    description:
      'Consumes the token and revokes every application session for the user. Sign in again afterward.',
  })
  @ApiBody({
    schema: {
      type: 'object',
      required: ['token', 'password'],
      additionalProperties: false,
      properties: {
        token: {
          type: 'string',
          description: 'One-time token from the reset email.',
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
  @ApiOkResponse({
    description: 'Password changed; all previous sessions revoked.',
    schema: { example: { message: 'Password reset. Please sign in again.' } },
  })
  @ApiBadRequestResponse({
    description: 'Invalid, expired, or used token, or password fails policy.',
  })
  @ApiForbiddenResponse({ description: 'Request origin is not permitted.' })
  async resetPassword(@Body() body: unknown): Promise<PasswordResetResponse> {
    const result = resetPasswordSchema.safeParse(body);
    if (!result.success)
      throw new BadRequestException('Invalid reset token or password');
    await this.passwordReset.resetPassword(
      result.data.token,
      result.data.password,
    );
    return { message: 'Password reset. Please sign in again.' };
  }
}
