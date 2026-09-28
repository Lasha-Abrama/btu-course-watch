import { ConfigService } from '@nestjs/config';
import type { Request, Response } from 'express';
import { GoogleOAuthStateStore } from './google-oauth-state.store.js';

describe('GoogleOAuthStateStore', () => {
  const config = new ConfigService({
    NODE_ENV: 'test',
    GOOGLE_CLIENT_SECRET: 'test-only-state-signing-secret',
  });

  it('issues a short-lived HttpOnly state cookie and validates the callback state once', async () => {
    const store = new GoogleOAuthStateStore(config);
    const cookie = vi.fn();
    const clearCookie = vi.fn();
    const setHeader = vi.fn();
    const response = { cookie, clearCookie, setHeader } as unknown as Response;
    const request = { res: response, headers: {} } as Request;
    const state = await new Promise<string>((resolve, reject) => {
      store.store(request, (error, value) =>
        error ? reject(error) : resolve(value!),
      );
    });

    expect(state).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(cookie).toHaveBeenCalledWith(
      'bcw_google_state',
      expect.any(String),
      expect.objectContaining({
        httpOnly: true,
        secure: false,
        sameSite: 'lax',
        path: '/api/v1/auth/google/callback',
        maxAge: 600_000,
      }),
    );
    const cookieValue = cookie.mock.calls[0]![1] as string;
    expect(cookieValue).not.toBe(state);
    expect(cookieValue).toMatch(/^\d{13}\.[A-Za-z0-9_-]{43}$/);
    request.headers.cookie = `bcw_google_state=${cookieValue}`;
    const valid = await new Promise<boolean>((resolve, reject) => {
      store.verify(request, state, (error, ok) =>
        error ? reject(error) : resolve(ok),
      );
    });
    expect(valid).toBe(true);
    expect(clearCookie).toHaveBeenCalledWith(
      'bcw_google_state',
      expect.objectContaining({ path: '/api/v1/auth/google/callback' }),
    );
    expect(setHeader).toHaveBeenCalledWith('Cache-Control', 'no-store');

    request.headers.cookie = undefined;
    const replay = await new Promise<boolean>((resolve, reject) => {
      store.verify(request, state, (error, ok) =>
        error ? reject(error) : resolve(ok),
      );
    });
    expect(replay).toBe(false);
  });

  it('rejects a forged callback state and uses Secure cookies in production', async () => {
    const store = new GoogleOAuthStateStore(
      new ConfigService({
        NODE_ENV: 'production',
        GOOGLE_CLIENT_SECRET: 'test-only-state-signing-secret',
      }),
    );
    const cookie = vi.fn();
    const response = {
      cookie,
      clearCookie: vi.fn(),
      setHeader: vi.fn(),
    } as unknown as Response;
    const request = { res: response, headers: {} } as Request;
    const state = await new Promise<string>((resolve) =>
      store.store(request, (_error, value) => resolve(value!)),
    );
    request.headers.cookie = `__Host-bcw_google_state=${cookie.mock.calls[0]![1] as string}`;
    const tampered = `${state.slice(0, -1)}${state.endsWith('A') ? 'B' : 'A'}`;
    const valid = await new Promise<boolean>((resolve) =>
      store.verify(request, tampered, (_error, ok) => resolve(ok)),
    );
    expect(valid).toBe(false);
    expect(cookie.mock.calls[0]![0]).toBe('__Host-bcw_google_state');
    expect(cookie.mock.calls[0]![2]).toEqual(
      expect.objectContaining({ secure: true, sameSite: 'lax', path: '/' }),
    );
  });

  it('rejects a state after its ten-minute server-side deadline', async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date('2026-09-28T12:00:00.000Z'));
      const store = new GoogleOAuthStateStore(config);
      const cookie = vi.fn();
      const request = {
        res: { cookie, clearCookie: vi.fn(), setHeader: vi.fn() },
        headers: {},
      } as unknown as Request;
      const state = await new Promise<string>((resolve) =>
        store.store(request, (_error, value) => resolve(value!)),
      );
      request.headers.cookie = `bcw_google_state=${cookie.mock.calls[0]![1] as string}`;
      vi.advanceTimersByTime(600_001);
      const valid = await new Promise<boolean>((resolve) =>
        store.verify(request, state, (_error, ok) => resolve(ok)),
      );
      expect(valid).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });
});
