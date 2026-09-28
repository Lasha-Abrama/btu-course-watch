import { ConfigService } from '@nestjs/config';
import type { Profile } from 'passport-google-oauth20';
import { GoogleStrategy } from './google.strategy.js';
import { GoogleOAuthStateStore } from './google-oauth-state.store.js';
import type { GoogleIdentityService } from './google-identity.service.js';

describe('GoogleStrategy profile handling', () => {
  const config = new ConfigService({
    NODE_ENV: 'test',
    GOOGLE_CLIENT_ID: 'test-client.apps.googleusercontent.com',
    GOOGLE_CLIENT_SECRET: 'test-only-secret',
    GOOGLE_CALLBACK_URL: 'http://localhost:3001/api/v1/auth/google/callback',
  });

  it('passes only Google subject, email, and explicit verification to identity resolution', async () => {
    const findOrCreateUser = vi.fn().mockResolvedValue('local-user-id');
    const strategy = new GoogleStrategy(
      config,
      new GoogleOAuthStateStore(config),
      { findOrCreateUser } as unknown as GoogleIdentityService,
    );
    const profile = {
      id: 'google-sub',
      provider: 'google',
      _json: {
        sub: 'google-sub',
        email: 'student@btu.edu.ge',
        email_verified: true,
      },
      emails: [{ value: 'student@btu.edu.ge', verified: true }],
    } as unknown as Profile;

    await expect(
      strategy.validate(
        'provider-access-token',
        'provider-refresh-token',
        profile,
      ),
    ).resolves.toBe('local-user-id');
    expect(findOrCreateUser).toHaveBeenCalledWith({
      subject: 'google-sub',
      email: 'student@btu.edu.ge',
      emailVerified: true,
    });
    expect(JSON.stringify(findOrCreateUser.mock.calls)).not.toContain(
      'provider-access-token',
    );
    expect(JSON.stringify(findOrCreateUser.mock.calls)).not.toContain(
      'provider-refresh-token',
    );
  });

  it('does not trust the parsed email flag if the raw Google verification claim is absent', async () => {
    const findOrCreateUser = vi.fn().mockResolvedValue('local-user-id');
    const strategy = new GoogleStrategy(
      config,
      new GoogleOAuthStateStore(config),
      { findOrCreateUser } as unknown as GoogleIdentityService,
    );
    const profile = {
      id: 'google-sub',
      provider: 'google',
      _json: { sub: 'google-sub', email: 'student@btu.edu.ge' },
      emails: [{ value: 'student@btu.edu.ge', verified: true }],
    } as unknown as Profile;

    await strategy.validate('provider-access-token', '', profile);
    expect(findOrCreateUser).toHaveBeenCalledWith(
      expect.objectContaining({ emailVerified: false }),
    );
  });
});
