import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import type { Request } from 'express';
import { getSessionCookies } from './session.cookies.js';
import { SessionService, type CurrentUser } from './session.service.js';

export interface AuthenticatedRequest extends Request {
  currentUser: CurrentUser;
}

@Injectable()
export class SessionGuard implements CanActivate {
  constructor(private readonly sessions: SessionService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    request.currentUser = await this.sessions.authenticate(
      getSessionCookies(request).accessToken,
    );
    return true;
  }
}
