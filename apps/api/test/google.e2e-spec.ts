import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { configureApplication } from '../src/app.setup.js';
import { GoogleOAuthGuard } from '../src/auth/google-oauth.guard.js';
import { MAIL_SENDER } from '../src/auth/mail/mail-sender.js';
import { PrismaService } from '../src/prisma/prisma.service.js';

describe('Google OAuth HTTP flow (e2e)', () => {
  let app: INestApplication;
  const localUserId = randomUUID();
  const sessionCreate = vi.fn().mockResolvedValue(undefined);

  function responseCookies(response: {
    headers: Record<string, string | string[] | undefined>;
  }): string[] {
    const value = response.headers['set-cookie'];
    return Array.isArray(value) ? value : value ? [value] : [];
  }

  async function startApp(withVerifiedGoogleGuard = false): Promise<void> {
    const builder = Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PrismaService)
      .useValue({
        $connect: () => Promise.resolve(),
        $disconnect: () => Promise.resolve(),
        authSession: { create: sessionCreate },
      })
      .overrideProvider(MAIL_SENDER)
      .useValue({
        sendEmailVerification: () => Promise.resolve(),
        sendPasswordReset: () => Promise.resolve(),
      });

    if (withVerifiedGoogleGuard) {
      builder.overrideGuard(GoogleOAuthGuard).useValue({
        canActivate(context: {
          switchToHttp: () => { getRequest: () => { user: string } };
        }) {
          context.switchToHttp().getRequest().user = localUserId;
          return true;
        },
      });
    }

    const fixture = await builder.compile();
    app = fixture.createNestApplication();
    configureApplication(app, app.get(ConfigService));
    await app.listen(0, '127.0.0.1');
  }

  afterEach(async () => {
    await app.close();
    sessionCreate.mockClear();
  });

  it('starts Google OAuth with fixed callback, minimal scopes, state, and no client redirect', async () => {
    await startApp();
    const response = await request(app.getHttpServer())
      .get('/api/v1/auth/google?redirect=https://evil.example/steal')
      .expect(302);
    const location = new URL(response.headers.location as string);
    expect(location.origin).toBe('https://accounts.google.com');
    expect(location.searchParams.get('redirect_uri')).toBe(
      'http://localhost:3001/api/v1/auth/google/callback',
    );
    expect(location.searchParams.get('scope')?.split(' ')).toEqual(
      expect.arrayContaining(['openid', 'email']),
    );
    expect(location.searchParams.get('state')).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(location.toString()).not.toContain('evil.example');
    expect(location.toString()).not.toContain('test-only-not-a-real-secret');
    const stateCookie = responseCookies(response);
    expect(stateCookie[0]).toContain('bcw_google_state=');
    expect(stateCookie[0]).toContain('HttpOnly');
    expect(stateCookie[0]).toContain('SameSite=Lax');

    const openapi = await request(app.getHttpServer())
      .get('/api/docs/openapi.json')
      .expect(200);
    expect(openapi.body.paths).toHaveProperty('/api/v1/auth/google');
    expect(openapi.body.paths).toHaveProperty('/api/v1/auth/google/callback');
    expect(JSON.stringify(openapi.body)).not.toContain(
      'test-only-not-a-real-secret',
    );
  });

  it('fails closed on Google denial and invalid state without issuing application cookies or leaking provider details', async () => {
    await startApp();
    const denied = await request(app.getHttpServer())
      .get(
        '/api/v1/auth/google/callback?error=access_denied&error_description=provider-secret',
      )
      .expect(401);
    const badState = await request(app.getHttpServer())
      .get('/api/v1/auth/google/callback?code=provider-code&state=invalid')
      .expect(401);
    expect(denied.body.message).toBe('Google authentication failed');
    expect(badState.body.message).toBe('Google authentication failed');
    expect(JSON.stringify(denied.body)).not.toContain('provider-secret');
    expect(JSON.stringify(badState.body)).not.toContain('provider-code');
    expect(denied.headers['referrer-policy']).toBe('no-referrer');
    expect(denied.headers['cache-control']).toBe('no-store');
    expect(denied.headers['set-cookie']).toBeUndefined();
    expect(sessionCreate).not.toHaveBeenCalled();
  });

  it('establishes the existing application cookies and redirects only to the configured frontend destination', async () => {
    await startApp(true); // Bypass Google's network exchange only; exercise the real callback/session code.
    const response = await request(app.getHttpServer())
      .get(
        '/api/v1/auth/google/callback?code=provider-code&redirect=https://evil.example',
      )
      .expect(302);
    expect(response.headers.location).toBe('http://localhost:3000/');
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.headers['referrer-policy']).toBe('no-referrer');
    const cookies = responseCookies(response);
    expect(cookies).toHaveLength(2);
    expect(cookies.some((cookie) => cookie.startsWith('bcw_access='))).toBe(
      true,
    );
    expect(cookies.some((cookie) => cookie.startsWith('bcw_refresh='))).toBe(
      true,
    );
    expect(
      cookies.every(
        (cookie) =>
          cookie.includes('HttpOnly') && cookie.includes('SameSite=Lax'),
      ),
    ).toBe(true);
    expect(cookies.join(' ')).not.toContain('provider-code');
    expect(sessionCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ userId: localUserId }),
      }),
    );
  });
});
