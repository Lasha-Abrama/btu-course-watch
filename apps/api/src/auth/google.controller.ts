import {
  Controller,
  Get,
  HttpStatus,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  ApiFoundResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { GoogleOAuthGuard } from './google-oauth.guard.js';
import { setSessionCookies } from './session.cookies.js';
import { SessionService } from './session.service.js';

interface GoogleAuthenticatedRequest extends Request {
  user: string;
}

@ApiTags('auth')
@Controller('auth')
export class GoogleController {
  constructor(
    private readonly sessions: SessionService,
    private readonly config: ConfigService,
  ) {}

  @Get('google')
  @UseGuards(GoogleOAuthGuard)
  @ApiOperation({
    summary: 'Start Google sign-in',
    description:
      'Redirects to Google with a short-lived, browser-bound OAuth state. Client redirect parameters are ignored.',
  })
  @ApiFoundResponse({ description: 'Redirect to Google OAuth consent.' })
  start(): void {
    // Passport sends the authorization redirect from the guard.
  }

  @Get('google/callback')
  @UseGuards(GoogleOAuthGuard)
  @ApiOperation({
    summary: 'Complete Google sign-in',
    description:
      'Google redirects here. Success sets the same HttpOnly application cookies as password login and redirects to a fixed configured frontend URL.',
  })
  @ApiFoundResponse({
    description:
      'Application session established; redirect to configured frontend destination.',
  })
  @ApiUnauthorizedResponse({
    description: 'Google sign-in failed; no application session was issued.',
  })
  async callback(
    @Req() request: GoogleAuthenticatedRequest,
    @Res() response: Response,
  ): Promise<void> {
    // Never reflect a query-string redirect or any provider token into Location.
    const tokens = await this.sessions.createSession(request.user);
    setSessionCookies(response, this.config, tokens);
    response.setHeader('Referrer-Policy', 'no-referrer');
    response.redirect(
      HttpStatus.FOUND,
      this.config.getOrThrow<string>('GOOGLE_POST_AUTH_REDIRECT_URL'),
    );
  }
}
