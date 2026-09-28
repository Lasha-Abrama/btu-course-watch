import { ConfigService } from '@nestjs/config';
import type { Response } from 'express';
import { setSessionCookies, clearSessionCookies } from './session.cookies.js';

describe('session cookie configuration', () => {
  it('uses HttpOnly Secure SameSite=None for cross-site production', () => {
    const config = new ConfigService({
      NODE_ENV: 'production',
      COOKIE_SAME_SITE: 'none',
    });
    const cookie = vi.fn();
    const clearCookie = vi.fn();
    const setHeader = vi.fn();
    const response = { cookie, clearCookie, setHeader } as unknown as Response;
    const now = Date.now();

    setSessionCookies(response, config, {
      accessToken: 'access',
      refreshToken: 'refresh',
      accessExpiresAt: new Date(now + 15 * 60_000),
      expiresAt: new Date(now + 30 * 24 * 60 * 60_000),
    });

    expect(cookie).toHaveBeenCalledWith(
      'bcw_access',
      'access',
      expect.objectContaining({
        httpOnly: true,
        secure: true,
        sameSite: 'none',
        path: '/api/v1',
      }),
    );
    expect(cookie).toHaveBeenCalledWith(
      'bcw_refresh',
      'refresh',
      expect.objectContaining({
        httpOnly: true,
        secure: true,
        sameSite: 'none',
        path: '/api/v1/auth',
      }),
    );
    expect(setHeader).toHaveBeenCalledWith('Cache-Control', 'no-store');

    clearSessionCookies(response, config);
    expect(clearCookie).toHaveBeenCalledWith(
      'bcw_access',
      expect.objectContaining({
        secure: true,
        sameSite: 'none',
        path: '/api/v1',
      }),
    );
    expect(clearCookie).toHaveBeenCalledWith(
      'bcw_refresh',
      expect.objectContaining({
        secure: true,
        sameSite: 'none',
        path: '/api/v1/auth',
      }),
    );
  });
});
