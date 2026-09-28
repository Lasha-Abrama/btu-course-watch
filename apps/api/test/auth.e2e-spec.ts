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

class InMemoryPrisma {
  readonly users = new Map<string, TestUser>();
  readonly tokens = new Map<string, TestToken>();

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

  async $transaction<T>(
    callback: (transaction: InMemoryPrisma) => Promise<T>,
  ): Promise<T> {
    const users = structuredClone(this.users);
    const tokens = structuredClone(this.tokens);

    try {
      return await callback(this);
    } catch (error) {
      this.users.clear();
      this.tokens.clear();
      for (const [key, value] of users) this.users.set(key, value);
      for (const [key, value] of tokens) this.tokens.set(key, value);
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
      ]),
    );
  });
});
