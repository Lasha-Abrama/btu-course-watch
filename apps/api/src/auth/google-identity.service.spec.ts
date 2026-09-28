import { randomUUID } from 'node:crypto';
import { UnauthorizedException } from '@nestjs/common';
import { GoogleIdentityService } from './google-identity.service.js';
import type { PrismaService } from '../prisma/prisma.service.js';

interface UserRecord {
  id: string;
  email: string;
  passwordHash: string | null;
  emailVerifiedAt: Date | null;
}

interface IdentityRecord {
  id: string;
  userId: string;
  subject: string;
}

class IdentityDatabase {
  readonly users = new Map<string, UserRecord>();
  readonly identities = new Map<string, IdentityRecord>();

  readonly googleIdentity = {
    findUnique: async ({ where }: { where: { subject: string } }) => {
      const identity = this.identities.get(where.subject);
      if (!identity) return null;
      const user = [...this.users.values()].find(
        (item) => item.id === identity.userId,
      );
      return { ...identity, user };
    },
    create: async ({ data }: { data: { userId: string; subject: string } }) => {
      const identity = { id: randomUUID(), ...data };
      this.identities.set(identity.subject, identity);
      return identity;
    },
  };

  readonly user = {
    findUnique: async ({ where }: { where: { email: string } }) => {
      const user = this.users.get(where.email);
      if (!user) return null;
      return {
        ...user,
        googleIdentity:
          [...this.identities.values()].find(
            (item) => item.userId === user.id,
          ) ?? null,
      };
    },
    create: async ({
      data,
    }: {
      data: {
        email: string;
        passwordHash: null;
        emailVerifiedAt: Date;
        googleIdentity: { create: { subject: string } };
      };
    }) => {
      const user: UserRecord = {
        id: randomUUID(),
        email: data.email,
        passwordHash: data.passwordHash,
        emailVerifiedAt: data.emailVerifiedAt,
      };
      this.users.set(user.email, user);
      this.identities.set(data.googleIdentity.create.subject, {
        id: randomUUID(),
        userId: user.id,
        subject: data.googleIdentity.create.subject,
      });
      return user;
    },
  };

  async $transaction<T>(
    callback: (database: IdentityDatabase) => Promise<T>,
  ): Promise<T> {
    return callback(this);
  }

  addUser(email: string, verified = true): UserRecord {
    const user = {
      id: randomUUID(),
      email,
      passwordHash: 'existing-argon2id-hash',
      emailVerifiedAt: verified ? new Date() : null,
    };
    this.users.set(email, user);
    return user;
  }
}

describe('GoogleIdentityService', () => {
  let database: IdentityDatabase;
  let service: GoogleIdentityService;

  beforeEach(() => {
    database = new IdentityDatabase();
    service = new GoogleIdentityService(database as unknown as PrismaService);
  });

  it('creates a verified Google-only BTU user without a local password', async () => {
    const userId = await service.findOrCreateUser({
      subject: 'google-sub-1',
      email: ' Student@BTU.EDU.GE ',
      emailVerified: true,
    });
    const user = database.users.get('student@btu.edu.ge');
    expect(user).toMatchObject({
      id: userId,
      email: 'student@btu.edu.ge',
      passwordHash: null,
    });
    expect(user?.emailVerifiedAt).toBeInstanceOf(Date);
    expect(database.identities.get('google-sub-1')?.userId).toBe(userId);
  });

  it.each([
    'student@gmail.com',
    'student@sub.btu.edu.ge',
    'student@btu.edu.ge.evil',
  ])('rejects non-BTU Google email %s', async (email) => {
    await expect(
      service.findOrCreateUser({
        subject: 'google-sub',
        email,
        emailVerified: true,
      }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(database.users.size).toBe(0);
  });

  it('rejects an unverified Google email before touching persistence', async () => {
    await expect(
      service.findOrCreateUser({
        subject: 'google-sub',
        email: 'student@btu.edu.ge',
        emailVerified: false,
      }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(database.users.size).toBe(0);
  });

  it('links a verified password user and preserves the existing password hash', async () => {
    const existing = database.addUser('student@btu.edu.ge');
    const userId = await service.findOrCreateUser({
      subject: 'google-sub',
      email: 'STUDENT@BTU.EDU.GE',
      emailVerified: true,
    });
    expect(userId).toBe(existing.id);
    expect(database.users.size).toBe(1);
    expect(database.users.get(existing.email)?.passwordHash).toBe(
      'existing-argon2id-hash',
    );
    expect(database.identities.get('google-sub')?.userId).toBe(existing.id);
  });

  it('uses the same user for repeated sign-in through the linked subject', async () => {
    const first = await service.findOrCreateUser({
      subject: 'google-sub',
      email: 'student@btu.edu.ge',
      emailVerified: true,
    });
    const second = await service.findOrCreateUser({
      subject: 'google-sub',
      email: 'STUDENT@BTU.EDU.GE',
      emailVerified: true,
    });
    expect(second).toBe(first);
    expect(database.users.size).toBe(1);
    expect(database.identities.size).toBe(1);
  });

  it('does not silently reassign an existing Google subject or link a second subject to the same user', async () => {
    await service.findOrCreateUser({
      subject: 'google-sub-1',
      email: 'student@btu.edu.ge',
      emailVerified: true,
    });
    await expect(
      service.findOrCreateUser({
        subject: 'google-sub-1',
        email: 'other@btu.edu.ge',
        emailVerified: true,
      }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    await expect(
      service.findOrCreateUser({
        subject: 'google-sub-2',
        email: 'student@btu.edu.ge',
        emailVerified: true,
      }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(database.users.size).toBe(1);
    expect(database.identities.size).toBe(1);
  });

  it('refuses to link to an unverified password account that may have pre-claimed the email', async () => {
    database.addUser('student@btu.edu.ge', false);
    await expect(
      service.findOrCreateUser({
        subject: 'google-sub',
        email: 'student@btu.edu.ge',
        emailVerified: true,
      }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(database.identities.size).toBe(0);
  });
});
