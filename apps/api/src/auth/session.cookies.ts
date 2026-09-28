import type { Request, Response, CookieOptions } from 'express';
import { parse } from 'cookie';
import { ConfigService } from '@nestjs/config';
import type { SessionTokens } from './session.service.js';

export const ACCESS_COOKIE = 'bcw_access';
export const REFRESH_COOKIE = 'bcw_refresh';
const ACCESS_PATH = '/api/v1';
const REFRESH_PATH = '/api/v1/auth';

function options(config: ConfigService, path: string): CookieOptions {
  return {
    httpOnly: true,
    secure: config.getOrThrow<string>('NODE_ENV') === 'production',
    sameSite: config.getOrThrow<'lax' | 'strict' | 'none'>('COOKIE_SAME_SITE'),
    path,
  };
}

export function getSessionCookies(request: Request): {
  accessToken?: string;
  refreshToken?: string;
} {
  const cookies = parse(request.headers.cookie ?? '');
  return {
    accessToken: cookies[ACCESS_COOKIE],
    refreshToken: cookies[REFRESH_COOKIE],
  };
}

export function setSessionCookies(
  response: Response,
  config: ConfigService,
  tokens: SessionTokens,
): void {
  response.cookie(ACCESS_COOKIE, tokens.accessToken, {
    ...options(config, ACCESS_PATH),
    expires: tokens.accessExpiresAt,
  });
  response.cookie(REFRESH_COOKIE, tokens.refreshToken, {
    ...options(config, REFRESH_PATH),
    expires: tokens.expiresAt,
  });
  response.setHeader('Cache-Control', 'no-store');
}

export function clearSessionCookies(
  response: Response,
  config: ConfigService,
): void {
  response.clearCookie(ACCESS_COOKIE, options(config, ACCESS_PATH));
  response.clearCookie(REFRESH_COOKIE, options(config, REFRESH_PATH));
  response.setHeader('Cache-Control', 'no-store');
}
