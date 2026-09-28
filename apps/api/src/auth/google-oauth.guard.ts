import {
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import type { Response } from 'express';

@Injectable()
export class GoogleOAuthGuard extends AuthGuard('google') {
  getAuthenticateOptions(context: ExecutionContext) {
    const response = context.switchToHttp().getResponse<Response>();
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('Referrer-Policy', 'no-referrer');
    return { session: false };
  }

  handleRequest<TUser = string>(
    error: unknown,
    user: unknown,
    _info: unknown,
    _context: ExecutionContext,
  ): TUser {
    // Passport/provider details can include authorization information; never
    // pass them through Nest's default exception handling or public responses.
    if (error || typeof user !== 'string') {
      throw new UnauthorizedException('Google authentication failed');
    }
    return user as TUser;
  }
}
