import { validateEnvironment } from './environment.js';

const valid = {
  NODE_ENV: 'development',
  PORT: '3001',
  DATABASE_URL: 'postgresql://local:local@localhost:5433/local',
  CORS_ORIGIN: 'http://localhost:3000',
  API_PUBLIC_URL: 'http://localhost:3001',
  SMTP_HOST: 'localhost',
  SMTP_PORT: '1025',
  SMTP_SECURE: 'false',
  SMTP_FROM: 'no-reply@btu.edu.ge',
  GOOGLE_CLIENT_ID: 'test-client.apps.googleusercontent.com',
  GOOGLE_CLIENT_SECRET: 'test-only-not-a-real-secret',
  GOOGLE_CALLBACK_URL: 'http://localhost:3001/api/v1/auth/google/callback',
  GOOGLE_POST_AUTH_REDIRECT_URL: 'http://localhost:3000/',
};

describe('Google OAuth environment validation', () => {
  it('accepts a fixed callback and same-origin frontend destination', () => {
    expect(validateEnvironment(valid)).toMatchObject({
      GOOGLE_CALLBACK_URL: valid.GOOGLE_CALLBACK_URL,
      GOOGLE_POST_AUTH_REDIRECT_URL: valid.GOOGLE_POST_AUTH_REDIRECT_URL,
    });
  });

  it('rejects a mismatched callback or externally controlled destination', () => {
    expect(() =>
      validateEnvironment({
        ...valid,
        GOOGLE_CALLBACK_URL: 'http://localhost:3001/other',
      }),
    ).toThrow('GOOGLE_CALLBACK_URL');
    expect(() =>
      validateEnvironment({
        ...valid,
        GOOGLE_POST_AUTH_REDIRECT_URL: 'https://evil.example/',
      }),
    ).toThrow('GOOGLE_POST_AUTH_REDIRECT_URL');
    expect(() =>
      validateEnvironment({
        ...valid,
        GOOGLE_POST_AUTH_REDIRECT_URL:
          'http://localhost:3000/?next=https://evil.example',
      }),
    ).toThrow('GOOGLE_POST_AUTH_REDIRECT_URL');
    expect(() =>
      validateEnvironment({
        ...valid,
        GOOGLE_POST_AUTH_REDIRECT_URL: 'not-a-url',
      }),
    ).toThrow('GOOGLE_POST_AUTH_REDIRECT_URL');
  });

  it('rejects missing or malformed Google client credentials', () => {
    expect(() =>
      validateEnvironment({ ...valid, GOOGLE_CLIENT_ID: 'invalid-client' }),
    ).toThrow('GOOGLE_CLIENT_ID');
    expect(() =>
      validateEnvironment({ ...valid, GOOGLE_CLIENT_SECRET: 'short' }),
    ).toThrow('GOOGLE_CLIENT_SECRET');
  });

  it('requires HTTPS callback and frontend origins in production', () => {
    expect(() =>
      validateEnvironment({ ...valid, NODE_ENV: 'production' }),
    ).toThrow();
  });
});
