import { Injectable, UnauthorizedException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { btuEmailSchema } from './auth.validation.js';

export interface VerifiedGoogleIdentity {
  subject: string;
  email: string;
  emailVerified: boolean;
}

const AUTHENTICATION_FAILED = 'Google authentication failed';

function isRetryableConflict(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    (error.code === 'P2002' || error.code === 'P2034')
  );
}

@Injectable()
export class GoogleIdentityService {
  constructor(private readonly prisma: PrismaService) {}

  async findOrCreateUser(identity: VerifiedGoogleIdentity): Promise<string> {
    const email = btuEmailSchema.safeParse(identity.email);
    if (
      identity.emailVerified !== true ||
      !email.success ||
      typeof identity.subject !== 'string' ||
      !/^[\x21-\x7e]{1,255}$/.test(identity.subject)
    ) {
      throw new UnauthorizedException(AUTHENTICATION_FAILED);
    }

    // A concurrent first sign-in may race on the unique email or subject.
    // Retry conflicts, then re-evaluate the linking rules against committed data.
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        return await this.prisma.$transaction(
          async (transaction) => {
            const linked = await transaction.googleIdentity.findUnique({
              where: { subject: identity.subject },
              include: { user: true },
            });
            if (linked) {
              if (
                linked.user.email !== email.data ||
                !linked.user.emailVerifiedAt
              ) {
                throw new UnauthorizedException(AUTHENTICATION_FAILED);
              }
              return linked.userId;
            }

            const existing = await transaction.user.findUnique({
              where: { email: email.data },
              include: { googleIdentity: true },
            });
            if (existing) {
              // Do not attach to an unverified password account: someone else
              // might have pre-claimed the address and know its password.
              if (!existing.emailVerifiedAt || existing.googleIdentity) {
                throw new UnauthorizedException(AUTHENTICATION_FAILED);
              }
              await transaction.googleIdentity.create({
                data: { userId: existing.id, subject: identity.subject },
              });
              return existing.id;
            }

            const user = await transaction.user.create({
              data: {
                email: email.data,
                passwordHash: null,
                emailVerifiedAt: new Date(),
                googleIdentity: { create: { subject: identity.subject } },
              },
            });
            return user.id;
          },
          { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
        );
      } catch (error) {
        if (isRetryableConflict(error)) continue;
        throw error;
      }
    }
    throw new UnauthorizedException(AUTHENTICATION_FAILED);
  }
}
