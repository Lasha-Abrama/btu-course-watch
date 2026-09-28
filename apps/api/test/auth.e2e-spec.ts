import { createHash, randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { Prisma } from '@prisma/client';
import * as argon2 from 'argon2';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { configureApplication } from '../src/app.setup.js';
import {
  MAIL_SENDER,
  type VerificationMessage,
} from '../src/auth/mail/mail-sender.js';
import { PrismaService } from '../src/prisma/prisma.service.js';

interface TestUser {
  id: string;
  email: string;
  passwordHash: string;
  emailVerifiedAt: Date | null;
}

interface TestToken {
  id: string;
  userId: string;
  tokenHash: string;
  expiresAt: Date;
  consumedAt: Date | null;
  sentAt: Date;
}

interface TestSession {
  id: string;
  userId: string;
  accessTokenHash: string;
  accessExpiresAt: Date;
  expiresAt: Date;
  revokedAt: Date | null;
}

interface TestRefreshToken {
  id: string;
  sessionId: string;
  tokenHash: string;
  rotatedAt: Date | null;
}

class InMemoryPrisma {
  readonly users = new Map<string, TestUser>();
  readonly tokens = new Map<string, TestToken>();
  readonly sessions = new Map<string, TestSession>();
  readonly refreshTokens = new Map<string, TestRefreshToken>();

  readonly user = {
    create: async ({
      data,
    }: {
      data: {
        email: string;
        passwordHash: string;
        emailVerificationToken: {
          create: { tokenHash: string; expiresAt: Date };
        };
      };
    }) => {
      if (this.users.has(data.email)) {
        throw new Prisma.PrismaClientKnownRequestError('Unique constraint', {
          code: 'P2002',
          clientVersion: '6.19.3',
        });
      }

      const user: TestUser = {
        id: randomUUID(),
        email: data.email,
        passwordHash: data.passwordHash,
        emailVerifiedAt: null,
      };
      this.users.set(user.email, user);
      this.tokens.set(user.id, {
        id: randomUUID(),
        userId: user.id,
        tokenHash: data.emailVerificationToken.create.tokenHash,
        expiresAt: data.emailVerificationToken.create.expiresAt,
        consumedAt: null,
        sentAt: new Date(),
      });
      return user;
    },
    findUnique: async ({ where }: { where: { email: string } }) => {
      const user = this.users.get(where.email);
      if (!user) return null;

      return {
        ...user,
        emailVerificationToken: this.tokens.get(user.id) ?? null,
      };
    },
    updateMany: async ({
      where,
      data,
    }: {
      where: { id: string; emailVerifiedAt: null };
      data: { emailVerifiedAt: Date };
    }) => {
      const user = [...this.users.values()].find(
        (item) => item.id === where.id,
      );
      if (!user || user.emailVerifiedAt) return { count: 0 };

      user.emailVerifiedAt = data.emailVerifiedAt;
      return { count: 1 };
    },
  };

  readonly emailVerificationToken = {
    findUnique: async ({ where }: { where: { tokenHash: string } }) =>
      [...this.tokens.values()].find(
        (token) => token.tokenHash === where.tokenHash,
      ) ?? null,
    updateMany: async ({
      where,
      data,
    }: {
      where: {
        id: string;
        tokenHash: string;
        consumedAt: null;
        expiresAt: { gt: Date };
      };
      data: { consumedAt: Date };
    }) => {
      const token = [...this.tokens.values()].find(
        (item) => item.id === where.id,
      );
      if (
        !token ||
        token.tokenHash !== where.tokenHash ||
        token.consumedAt ||
        token.expiresAt <= where.expiresAt.gt
      ) {
        return { count: 0 };
      }

      token.consumedAt = data.consumedAt;
      return { count: 1 };
    },
    upsert: async ({
      where,
      create,
      update,
    }: {
      where: { userId: string };
      create: {
        userId: string;
        tokenHash: string;
        expiresAt: Date;
        sentAt: Date;
      };
      update: {
        tokenHash: string;
        expiresAt: Date;
        consumedAt: null;
        sentAt: Date;
      };
    }) => {
      const existing = this.tokens.get(where.userId);
      if (existing) {
        Object.assign(existing, update);
        return existing;
      }

      const token: TestToken = {
        id: randomUUID(),
        ...create,
        consumedAt: null,
      };
      this.tokens.set(where.userId, token);
      return token;
    },
  };

  readonly authSession = {
    create: async ({
      data,
    }: {
      data: {
        userId: string;
        accessTokenHash: string;
        accessExpiresAt: Date;
        expiresAt: Date;
        refreshTokens: { create: { tokenHash: string } };
      };
    }) => {
      const session: TestSession = {
        id: randomUUID(),
        userId: data.userId,
        accessTokenHash: data.accessTokenHash,
        accessExpiresAt: data.accessExpiresAt,
        expiresAt: data.expiresAt,
        revokedAt: null,
      };
      this.sessions.set(session.id, session);
      const refresh: TestRefreshToken = {
        id: randomUUID(),
        sessionId: session.id,
        tokenHash: data.refreshTokens.create.tokenHash,
        rotatedAt: null,
      };
      this.refreshTokens.set(refresh.id, refresh);
      return session;
    },
    findUnique: async ({ where }: { where: { accessTokenHash: string } }) => {
      const session = [...this.sessions.values()].find(
        (item) => item.accessTokenHash === where.accessTokenHash,
      );
      if (!session) return null;
      const user = [...this.users.values()].find(
        (item) => item.id === session.userId,
      );
      return { ...session, user };
    },
    updateMany: async ({
      where,
      data,
    }: {
      where: {
        id?: string;
        accessTokenHash?: string;
        revokedAt: null;
        expiresAt?: { gt: Date };
      };
      data: {
        revokedAt?: Date;
        accessTokenHash?: string;
        accessExpiresAt?: Date;
      };
    }) => {
      const session = [...this.sessions.values()].find((item) =>
        where.id
          ? item.id === where.id
          : item.accessTokenHash === where.accessTokenHash,
      );
      if (
        !session ||
        session.revokedAt ||
        (where.expiresAt && session.expiresAt <= where.expiresAt.gt)
      )
        return { count: 0 };
      Object.assign(session, data);
      return { count: 1 };
    },
  };

  readonly refreshToken = {
    findUnique: async ({ where }: { where: { tokenHash: string } }) => {
      const token = [...this.refreshTokens.values()].find(
        (item) => item.tokenHash === where.tokenHash,
      );
      if (!token) return null;
      const session = this.sessions.get(token.sessionId)!;
      const user = [...this.users.values()].find(
        (item) => item.id === session.userId,
      );
      return { ...token, session: { ...session, user } };
    },
    updateMany: async ({
      where,
      data,
    }: {
      where: { id: string; rotatedAt: null };
      data: { rotatedAt: Date };
    }) => {
      const token = this.refreshTokens.get(where.id);
      if (!token || token.rotatedAt) return { count: 0 };
      token.rotatedAt = data.rotatedAt;
      return { count: 1 };
    },
    create: async ({
      data,
    }: {
      data: { sessionId: string; tokenHash: string };
    }) => {
      const token: TestRefreshToken = {
        id: randomUUID(),
        sessionId: data.sessionId,
        tokenHash: data.tokenHash,
        rotatedAt: null,
      };
      this.refreshTokens.set(token.id, token);
      return token;
    },
  };

  async $transaction<T>(
    callback: (transaction: InMemoryPrisma) => Promise<T>,
  ): Promise<T> {
    const users = structuredClone(this.users);
    const tokens = structuredClone(this.tokens);
    const sessions = structuredClone(this.sessions);
    const refreshTokens = structuredClone(this.refreshTokens);

    try {
      return await callback(this);
    } catch (error) {
      this.users.clear();
      this.tokens.clear();
      for (const [key, value] of users) this.users.set(key, value);
      for (const [key, value] of tokens) this.tokens.set(key, value);
      this.sessions.clear();
      this.refreshTokens.clear();
      for (const [key, value] of sessions) this.sessions.set(key, value);
      for (const [key, value] of refreshTokens)
        this.refreshTokens.set(key, value);
      throw error;
    }
  }

  $connect(): Promise<void> {
    return Promise.resolve();
  }

  $disconnect(): Promise<void> {
    return Promise.resolve();
  }
}

class TestMailSender {
  readonly messages: VerificationMessage[] = [];
  fail = false;

  async sendEmailVerification(message: VerificationMessage): Promise<void> {
    if (this.fail) throw new Error('SMTP unavailable');
    this.messages.push(message);
  }
}

describe('Authentication HTTP flows (e2e)', () => {
  let app: INestApplication;
  let database: InMemoryPrisma;
  let mail: TestMailSender;

  beforeEach(async () => {
    database = new InMemoryPrisma();
    mail = new TestMailSender();
    const moduleFixture = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(PrismaService)
      .useValue(database)
      .overrideProvider(MAIL_SENDER)
      .useValue(mail)
      .compile();

    app = moduleFixture.createNestApplication();
    configureApplication(app, app.get(ConfigService));
    await app.listen(0, '127.0.0.1');
  });

  afterEach(async () => {
    await app.close();
  });

  function register(email = ' Student@BTU.EDU.GE ') {
    return request(app.getHttpServer()).post('/api/v1/auth/register').send({
      email,
      password: 'A sufficiently strong passphrase 42',
    });
  }

  async function verifiedUser() {
    await register().expect(202);
    await request(app.getHttpServer())
      .post('/api/v1/auth/verify-email')
      .send({ token: mail.messages[0]!.token })
      .expect(200);
    return database.users.get('student@btu.edu.ge')!;
  }

  function login(password = 'A sufficiently strong passphrase 42') {
    return request(app.getHttpServer()).post('/api/v1/auth/login').send({
      email: ' STUDENT@BTU.EDU.GE ',
      password,
    });
  }

  function cookies(response: {
    headers: Record<string, string | string[] | undefined>;
  }): string[] {
    const header = response.headers['set-cookie'];
    return Array.isArray(header) ? header : header ? [header] : [];
  }

  function cookieValue(headers: string[], name: string): string {
    const cookie = headers.find((item) => item.startsWith(`${name}=`));
    expect(cookie).toBeDefined();
    return cookie!.split(';')[0]!;
  }

  it('normalizes BTU email, hashes the password and token, and sends one email', async () => {
    const response = await register().expect(202);
    const user = database.users.get('student@btu.edu.ge');
    const message = mail.messages[0];
    const token = user && database.tokens.get(user.id);

    expect(response.body).toEqual({
      message: 'If eligible, a verification email will be sent.',
    });
    expect(user).toBeDefined();
    expect(user?.passwordHash).toMatch(/^\$argon2id\$/);
    expect(
      await argon2.verify(
        user!.passwordHash,
        'A sufficiently strong passphrase 42',
      ),
    ).toBe(true);
    expect(message?.to).toBe('student@btu.edu.ge');
    expect(message?.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(token?.tokenHash).toBe(
      createHash('sha256').update(message.token).digest('hex'),
    );
    expect(token?.tokenHash).not.toBe(message.token);
    expect(token!.expiresAt.getTime() - Date.now()).toBeGreaterThan(
      23 * 60 * 60 * 1_000,
    );
  });

  it.each([
    'student@gmail.com',
    'student@sub.btu.edu.ge',
    'student@btu.edu.ge.evil',
  ])('rejects non-BTU email %s', async (email) => {
    await register(email).expect(400);
    expect(database.users.size).toBe(0);
    expect(mail.messages).toHaveLength(0);
  });

  it('rejects weak passwords without creating a user', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send({ email: 'student@btu.edu.ge', password: 'password123' })
      .expect(400);

    expect(database.users.size).toBe(0);

    await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send({ email: 'student@btu.edu.ge', password: 'a'.repeat(24) })
      .expect(400);

    expect(database.users.size).toBe(0);
  });

  it('keeps duplicate registration responses identical and sends no second email', async () => {
    const first = await register().expect(202);
    const duplicate = await register('STUDENT@btu.edu.ge').expect(202);

    expect(duplicate.body).toEqual(first.body);
    expect(database.users.size).toBe(1);
    expect(mail.messages).toHaveLength(1);
  });

  it('rejects invalid, expired, and already-used tokens', async () => {
    await register().expect(202);
    const user = database.users.get('student@btu.edu.ge')!;
    const token = mail.messages[0]!.token;

    await request(app.getHttpServer())
      .post('/api/v1/auth/verify-email')
      .send({ token: 'A'.repeat(43) })
      .expect(400);

    database.tokens.get(user.id)!.expiresAt = new Date(Date.now() - 1);
    await request(app.getHttpServer())
      .post('/api/v1/auth/verify-email')
      .send({ token })
      .expect(400);
    expect(user.emailVerifiedAt).toBeNull();

    database.tokens.get(user.id)!.expiresAt = new Date(Date.now() + 60_000);
    await request(app.getHttpServer())
      .post('/api/v1/auth/verify-email')
      .send({ token })
      .expect(200);
    await request(app.getHttpServer())
      .post('/api/v1/auth/verify-email')
      .send({ token })
      .expect(400);
  });

  it('marks the user verified and consumes the token together', async () => {
    await register().expect(202);
    const token = mail.messages[0]!.token;

    const response = await request(app.getHttpServer())
      .post('/api/v1/auth/verify-email')
      .send({ token })
      .expect(200);

    const user = database.users.get('student@btu.edu.ge')!;
    expect(response.body).toEqual({ message: 'Email verified.' });
    expect(user.emailVerifiedAt).toBeInstanceOf(Date);
    expect(database.tokens.get(user.id)?.consumedAt).toBeInstanceOf(Date);
  });

  it('resends only after cooldown, replaces the old token, and does not reveal account status', async () => {
    const unknown = await request(app.getHttpServer())
      .post('/api/v1/auth/resend-verification')
      .send({ email: 'unknown@btu.edu.ge' })
      .expect(202);
    expect(mail.messages).toHaveLength(0);

    await register().expect(202);
    const oldToken = mail.messages[0]!.token;
    const user = database.users.get('student@btu.edu.ge')!;
    const record = database.tokens.get(user.id)!;

    const tooSoon = await request(app.getHttpServer())
      .post('/api/v1/auth/resend-verification')
      .send({ email: 'STUDENT@BTU.EDU.GE' })
      .expect(202);
    expect(tooSoon.body).toEqual(unknown.body);
    expect(mail.messages).toHaveLength(1);

    record.sentAt = new Date(Date.now() - 61_000);
    await request(app.getHttpServer())
      .post('/api/v1/auth/resend-verification')
      .send({ email: 'student@btu.edu.ge' })
      .expect(202);
    expect(mail.messages).toHaveLength(2);
    expect(mail.messages[1]!.token).not.toBe(oldToken);

    await request(app.getHttpServer())
      .post('/api/v1/auth/verify-email')
      .send({ token: oldToken })
      .expect(400);
    await request(app.getHttpServer())
      .post('/api/v1/auth/verify-email')
      .send({ token: mail.messages[1]!.token })
      .expect(200);

    record.sentAt = new Date(Date.now() - 61_000);
    await request(app.getHttpServer())
      .post('/api/v1/auth/resend-verification')
      .send({ email: 'student@btu.edu.ge' })
      .expect(202);
    expect(mail.messages).toHaveLength(2);
  });

  it('keeps SMTP failures out of public responses and allows a later resend', async () => {
    mail.fail = true;
    const first = await register().expect(202);
    const user = database.users.get('student@btu.edu.ge')!;
    expect(mail.messages).toHaveLength(0);

    mail.fail = false;
    database.tokens.get(user.id)!.sentAt = new Date(Date.now() - 61_000);
    const resent = await request(app.getHttpServer())
      .post('/api/v1/auth/resend-verification')
      .send({ email: user.email })
      .expect(202);

    expect(resent.body).toEqual(first.body);
    expect(mail.messages).toHaveLength(1);
  });

  it('publishes the three authentication routes in OpenAPI', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/docs/openapi.json')
      .expect(200);

    expect(Object.keys(response.body.paths)).toEqual(
      expect.arrayContaining([
        '/api/v1/auth/register',
        '/api/v1/auth/verify-email',
        '/api/v1/auth/resend-verification',
        '/api/v1/auth/login',
        '/api/v1/auth/refresh',
        '/api/v1/auth/logout',
        '/api/v1/users/me',
      ]),
    );
    expect(response.body.paths['/api/v1/users/me'].get.security).toContainEqual(
      { accessCookie: [] },
    );
    expect(
      response.body.paths['/api/v1/auth/refresh'].post.security,
    ).toContainEqual({ refreshCookie: [] });
  });

  it('logs in verified users, hashes tokens, and issues HttpOnly same-site cookies', async () => {
    await verifiedUser();
    const response = await login().expect(204);
    expect(response.body).toEqual({});
    expect(response.headers['cache-control']).toBe('no-store');
    const issued = cookies(response);
    expect(issued).toHaveLength(2);
    expect(
      issued.every(
        (item) => item.includes('HttpOnly') && item.includes('SameSite=Lax'),
      ),
    ).toBe(true);
    expect(issued.every((item) => !item.includes('Secure'))).toBe(true);
    expect(issued.find((item) => item.startsWith('bcw_access='))).toContain(
      'Path=/api/v1',
    );
    expect(issued.find((item) => item.startsWith('bcw_refresh='))).toContain(
      'Path=/api/v1/auth',
    );
    const session = [...database.sessions.values()][0]!;
    const refresh = [...database.refreshTokens.values()][0]!;
    expect(session.accessTokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(refresh.tokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(session.accessTokenHash).not.toBe(
      cookieValue(issued, 'bcw_access').split('=')[1],
    );
    expect(session.accessExpiresAt.getTime() - Date.now()).toBeGreaterThan(
      14 * 60_000,
    );
    expect(session.expiresAt.getTime() - Date.now()).toBeGreaterThan(
      29 * 24 * 60 * 60_000,
    );
  });

  it('returns the same failure for wrong password, unknown user, and unverified user', async () => {
    await register().expect(202);
    const unverified = await login().expect(401);
    const unknown = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({
        email: 'unknown@btu.edu.ge',
        password: 'A sufficiently strong passphrase 42',
      })
      .expect(401);
    await request(app.getHttpServer())
      .post('/api/v1/auth/verify-email')
      .send({ token: mail.messages[0]!.token })
      .expect(200);
    const wrong = await login('wrong').expect(401);
    const wrongDomain = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({
        email: 'student@example.com',
        password: 'A sufficiently strong passphrase 42',
      })
      .expect(401);
    expect(unverified.body).toEqual(unknown.body);
    expect(wrong.body).toEqual(unknown.body);
    expect(wrongDomain.body).toEqual(unknown.body);
    expect(database.sessions.size).toBe(0);
  });

  it('protects /users/me and returns only safe profile fields', async () => {
    const user = await verifiedUser();
    await request(app.getHttpServer()).get('/api/v1/users/me').expect(401);
    await request(app.getHttpServer())
      .get('/api/v1/users/me')
      .set('Cookie', 'bcw_access=invalid')
      .expect(401);
    await request(app.getHttpServer())
      .get('/api/v1/users/me')
      .set('Cookie', `bcw_access=${'A'.repeat(43)}`)
      .expect(401);
    const loginResponse = await login().expect(204);
    const access = cookieValue(cookies(loginResponse), 'bcw_access');
    const response = await request(app.getHttpServer())
      .get('/api/v1/users/me')
      .set('Cookie', access)
      .expect(200);
    expect(response.body).toEqual({
      id: user.id,
      email: user.email,
      emailVerifiedAt: user.emailVerifiedAt!.toISOString(),
    });
    const session = [...database.sessions.values()][0]!;
    session.accessExpiresAt = new Date(Date.now() - 1);
    await request(app.getHttpServer())
      .get('/api/v1/users/me')
      .set('Cookie', access)
      .expect(401);
  });

  it('rotates refresh tokens and revokes the family when an old token is reused', async () => {
    await verifiedUser();
    const initial = await login().expect(204);
    const oldRefresh = cookieValue(cookies(initial), 'bcw_refresh');
    const rotated = await request(app.getHttpServer())
      .post('/api/v1/auth/refresh')
      .set('Cookie', oldRefresh)
      .expect(204);
    const newRefresh = cookieValue(cookies(rotated), 'bcw_refresh');
    const newAccess = cookieValue(cookies(rotated), 'bcw_access');
    const oldAccess = cookieValue(cookies(initial), 'bcw_access');
    expect(newRefresh).not.toBe(oldRefresh);
    await request(app.getHttpServer())
      .get('/api/v1/users/me')
      .set('Cookie', newAccess)
      .expect(200);
    await request(app.getHttpServer())
      .get('/api/v1/users/me')
      .set('Cookie', oldAccess)
      .expect(401);
    await request(app.getHttpServer())
      .post('/api/v1/auth/refresh')
      .set('Cookie', oldRefresh)
      .expect(401);
    await request(app.getHttpServer())
      .post('/api/v1/auth/refresh')
      .set('Cookie', newRefresh)
      .expect(401);
    await request(app.getHttpServer())
      .get('/api/v1/users/me')
      .set('Cookie', newAccess)
      .expect(401);
  });

  it('rejects missing and unknown refresh tokens without issuing cookies', async () => {
    await request(app.getHttpServer()).post('/api/v1/auth/refresh').expect(401);
    const unknown = await request(app.getHttpServer())
      .post('/api/v1/auth/refresh')
      .set('Cookie', `bcw_refresh=${'A'.repeat(43)}`)
      .expect(401);
    expect(cookies(unknown)).toHaveLength(0);
  });

  it('rejects expired and revoked sessions and logout clears cookies', async () => {
    await verifiedUser();
    const initial = await login().expect(204);
    const refresh = cookieValue(cookies(initial), 'bcw_refresh');
    const access = cookieValue(cookies(initial), 'bcw_access');
    const session = [...database.sessions.values()][0]!;
    session.expiresAt = new Date(Date.now() - 1);
    await request(app.getHttpServer())
      .post('/api/v1/auth/refresh')
      .set('Cookie', refresh)
      .expect(401);
    session.expiresAt = new Date(Date.now() + 60_000);
    const logout = await request(app.getHttpServer())
      .post('/api/v1/auth/logout')
      .set('Cookie', `${refresh}; ${access}`)
      .expect(204);
    expect(cookies(logout)).toHaveLength(2);
    expect(session.revokedAt).toBeInstanceOf(Date);
    await request(app.getHttpServer())
      .post('/api/v1/auth/refresh')
      .set('Cookie', refresh)
      .expect(401);
    await request(app.getHttpServer())
      .get('/api/v1/users/me')
      .set('Cookie', access)
      .expect(401);
  });

  it('allows the trusted frontend origin and rejects hostile browser origins for mutations', async () => {
    await verifiedUser();
    await login()
      .set('Origin', 'http://localhost:3000')
      .set('Sec-Fetch-Site', 'same-site')
      .expect(204);
    await login()
      .set('Origin', 'https://evil.example')
      .set('Sec-Fetch-Site', 'cross-site')
      .expect(403);
    await request(app.getHttpServer())
      .post('/api/v1/auth/refresh')
      .set('Origin', 'https://evil.example')
      .expect(403);
    await request(app.getHttpServer())
      .post('/api/v1/auth/logout')
      .set('Origin', 'https://evil.example')
      .expect(403);
  });
});
