import { createHash, randomBytes } from 'node:crypto';
import { Injectable, UnauthorizedException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';

export const ACCESS_LIFETIME_MS = 15 * 60 * 1_000;
export const SESSION_LIFETIME_MS = 30 * 24 * 60 * 60 * 1_000;
const INVALID_SESSION = 'Authentication required';

export interface SessionTokens {
  accessToken: string;
  refreshToken: string;
  accessExpiresAt: Date;
  expiresAt: Date;
}

export interface CurrentUser {
  id: string;
  email: string;
  emailVerifiedAt: Date;
}

function newToken(): string {
  return randomBytes(32).toString('base64url');
}

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function isToken(token: string | undefined): token is string {
  return typeof token === 'string' && /^[A-Za-z0-9_-]{43}$/.test(token);
}

@Injectable()
export class SessionService {
  constructor(private readonly prisma: PrismaService) {}

  // Also usable by a future OAuth callback once it has identified a local User.
  async createSession(userId: string): Promise<SessionTokens> {
    const now = Date.now();
    const accessToken = newToken();
    const refreshToken = newToken();
    const accessExpiresAt = new Date(now + ACCESS_LIFETIME_MS);
    const expiresAt = new Date(now + SESSION_LIFETIME_MS);

    await this.prisma.authSession.create({
      data: {
        userId,
        accessTokenHash: hashToken(accessToken),
        accessExpiresAt,
        expiresAt,
        refreshTokens: { create: { tokenHash: hashToken(refreshToken) } },
      },
    });

    return { accessToken, refreshToken, accessExpiresAt, expiresAt };
  }

  async authenticate(accessToken: string | undefined): Promise<CurrentUser> {
    if (!isToken(accessToken)) throw new UnauthorizedException(INVALID_SESSION);
    const session = await this.prisma.authSession.findUnique({
      where: { accessTokenHash: hashToken(accessToken) },
      include: { user: true },
    });
    const now = new Date();
    if (
      !session ||
      session.revokedAt ||
      session.expiresAt <= now ||
      session.accessExpiresAt <= now ||
      !session.user.emailVerifiedAt
    ) {
      throw new UnauthorizedException(INVALID_SESSION);
    }
    return {
      id: session.user.id,
      email: session.user.email,
      emailVerifiedAt: session.user.emailVerifiedAt,
    };
  }

  async refresh(refreshToken: string | undefined): Promise<SessionTokens> {
    if (!isToken(refreshToken))
      throw new UnauthorizedException(INVALID_SESSION);
    const now = new Date();
    const nextAccessToken = newToken();
    const nextRefreshToken = newToken();

    try {
      const outcome = await this.prisma.$transaction(
        async (transaction) => {
          const record = await transaction.refreshToken.findUnique({
            where: { tokenHash: hashToken(refreshToken) },
            include: { session: { include: { user: true } } },
          });
          if (!record) return null;

          const session = record.session;
          if (record.rotatedAt) {
            // Reuse signals possible theft. Invalidate the entire token family.
            await transaction.authSession.updateMany({
              where: { id: session.id, revokedAt: null },
              data: { revokedAt: now },
            });
            return null;
          }
          if (
            session.revokedAt ||
            session.expiresAt <= now ||
            !session.user.emailVerifiedAt
          )
            return null;

          const rotated = await transaction.refreshToken.updateMany({
            where: { id: record.id, rotatedAt: null },
            data: { rotatedAt: now },
          });
          if (rotated.count !== 1) return null;

          const accessExpiresAt = new Date(now.getTime() + ACCESS_LIFETIME_MS);
          await transaction.refreshToken.create({
            data: {
              sessionId: session.id,
              tokenHash: hashToken(nextRefreshToken),
            },
          });
          const updated = await transaction.authSession.updateMany({
            where: { id: session.id, revokedAt: null, expiresAt: { gt: now } },
            data: {
              accessTokenHash: hashToken(nextAccessToken),
              accessExpiresAt,
            },
          });
          if (updated.count !== 1)
            throw new UnauthorizedException(INVALID_SESSION);
          return { accessExpiresAt, expiresAt: session.expiresAt };
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
      if (!outcome) throw new UnauthorizedException(INVALID_SESSION);
      return {
        accessToken: nextAccessToken,
        refreshToken: nextRefreshToken,
        ...outcome,
      };
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2034'
      ) {
        throw new UnauthorizedException(INVALID_SESSION);
      }
      throw error;
    }
  }

  async revoke(
    refreshToken: string | undefined,
    accessToken: string | undefined,
  ): Promise<void> {
    if (isToken(refreshToken)) {
      const record = await this.prisma.refreshToken.findUnique({
        where: { tokenHash: hashToken(refreshToken) },
      });
      if (record) {
        await this.prisma.authSession.updateMany({
          where: { id: record.sessionId, revokedAt: null },
          data: { revokedAt: new Date() },
        });
      }
    }
    if (isToken(accessToken)) {
      await this.prisma.authSession.updateMany({
        where: { accessTokenHash: hashToken(accessToken), revokedAt: null },
        data: { revokedAt: new Date() },
      });
    }
  }
}
