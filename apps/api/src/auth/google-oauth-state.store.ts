import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { parse } from 'cookie';
import type { CookieOptions, Request, Response } from 'express';

const CALLBACK_PATH = '/api/v1/auth/google/callback';
const STATE_LIFETIME_MS = 10 * 60_000;
type StoreCallback = (error: Error | null, state?: string) => void;
type VerifyCallback = (
  error: Error | null,
  valid: boolean,
  state: unknown,
) => void;

@Injectable()
export class GoogleOAuthStateStore {
  private readonly secret: string;
  private readonly secure: boolean;
  private readonly cookieName: string;

  constructor(config: ConfigService) {
    this.secret = config.getOrThrow<string>('GOOGLE_CLIENT_SECRET');
    this.secure = config.getOrThrow<string>('NODE_ENV') === 'production';
    this.cookieName = this.secure
      ? '__Host-bcw_google_state'
      : 'bcw_google_state';
  }

  private cookieOptions(): CookieOptions {
    return {
      httpOnly: true,
      secure: this.secure,
      sameSite: 'lax', // Google's top-level GET callback must carry the cookie.
      path: this.secure ? '/' : CALLBACK_PATH,
    };
  }

  private signature(state: string, expiresAt: number): Buffer {
    return createHmac('sha256', this.secret)
      .update('btu-course-watch:google-oauth-state:v1:')
      .update(state)
      .update(':')
      .update(String(expiresAt))
      .digest();
  }

  store(request: Request, callback: StoreCallback): void;
  store(request: Request, metadata: unknown, callback: StoreCallback): void;
  store(
    request: Request,
    metadataOrCallback: unknown,
    maybeCallback?: StoreCallback,
  ): void {
    const callback = maybeCallback ?? (metadataOrCallback as StoreCallback);
    const response = request.res;
    if (!response) return callback(new Error('OAuth response is unavailable'));
    const state = randomBytes(32).toString('base64url');
    const expiresAt = Date.now() + STATE_LIFETIME_MS;
    const signed = `${expiresAt}.${this.signature(state, expiresAt).toString('base64url')}`;
    response.cookie(this.cookieName, signed, {
      ...this.cookieOptions(),
      maxAge: STATE_LIFETIME_MS,
    });
    response.setHeader('Cache-Control', 'no-store');
    callback(null, state);
  }

  verify(request: Request, state: string, callback: VerifyCallback): void;
  verify(
    request: Request,
    state: string,
    metadata: unknown,
    callback: VerifyCallback,
  ): void;
  verify(
    request: Request,
    state: string,
    metadataOrCallback: unknown,
    maybeCallback?: VerifyCallback,
  ): void {
    const callback = maybeCallback ?? (metadataOrCallback as VerifyCallback);
    const response: Response | undefined = request.res;
    response?.clearCookie(this.cookieName, this.cookieOptions());
    response?.setHeader('Cache-Control', 'no-store');

    const cookie = parse(request.headers.cookie ?? '')[this.cookieName];
    if (
      typeof state !== 'string' ||
      !/^[A-Za-z0-9_-]{43}$/.test(state) ||
      !cookie ||
      !/^\d{13}\.[A-Za-z0-9_-]{43}$/.test(cookie)
    )
      return callback(null, false, undefined);

    const [expiry, tag] = cookie.split('.', 2);
    const expiresAt = Number(expiry);
    if (!Number.isSafeInteger(expiresAt) || expiresAt <= Date.now()) {
      return callback(null, false, undefined);
    }
    const expected = this.signature(state, expiresAt);
    const received = Buffer.from(tag, 'base64url');
    callback(
      null,
      received.length === expected.length &&
        timingSafeEqual(received, expected),
      undefined,
    );
  }
}
