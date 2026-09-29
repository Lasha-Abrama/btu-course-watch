import {
  createHash,
  randomBytes,
  randomUUID,
  timingSafeEqual,
} from 'node:crypto';
import {
  BadRequestException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';

const LINK_LIFETIME_MS = 5 * 60_000;
const CREDENTIAL_LIFETIME_MS = 90 * 24 * 60 * 60_000;
const INVALID_LINK = 'Extension authorization unavailable';
const INVALID_CREDENTIAL = 'Extension authorization required';

function hash(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

export interface ExtensionIdentity {
  userId: string;
  authorizationId: string;
  expiresAt: Date;
}

@Injectable()
export class ExtensionAuthService {
  constructor(private readonly prisma: PrismaService) {}

  async start(
    installationId: string,
    extensionId: string,
    challengeHash: string,
  ) {
    const now = new Date();
    await this.prisma.extensionLinkRequest.deleteMany({
      where: { expiresAt: { lt: now } },
    });
    const request = await this.prisma.extensionLinkRequest.create({
      data: {
        id: randomUUID(),
        installationId,
        extensionId,
        challengeHash,
        expiresAt: new Date(now.getTime() + LINK_LIFETIME_MS),
      },
    });
    return {
      requestId: request.id,
      expiresAt: request.expiresAt.toISOString(),
    };
  }

  async approvalInfo(requestId: string, userId: string) {
    const request = await this.prisma.extensionLinkRequest.findUnique({
      where: { id: requestId },
    });
    if (
      !request ||
      request.expiresAt <= new Date() ||
      (request.approvedByUserId && request.approvedByUserId !== userId)
    ) {
      throw new NotFoundException('Extension request not found');
    }
    return {
      requestId: request.id,
      pairingCode: request.id.slice(-6).toUpperCase(),
      expiresAt: request.expiresAt.toISOString(),
      approved: request.approvedAt !== null,
    };
  }

  async approve(requestId: string, userId: string): Promise<void> {
    const updated = await this.prisma.extensionLinkRequest.updateMany({
      where: {
        id: requestId,
        expiresAt: { gt: new Date() },
        approvedAt: null,
        consumedAt: null,
      },
      data: { approvedByUserId: userId, approvedAt: new Date() },
    });
    if (updated.count !== 1)
      throw new BadRequestException('Extension request unavailable');
  }

  async exchange(requestId: string, verifier: string, extensionId: string) {
    const credential = `bcwx_${randomBytes(32).toString('base64url')}`;
    const now = new Date();
    try {
      const result = await this.prisma.$transaction(
        async (tx) => {
          const request = await tx.extensionLinkRequest.findUnique({
            where: { id: requestId },
          });
          if (
            !request ||
            request.extensionId !== extensionId ||
            request.expiresAt <= now ||
            request.consumedAt ||
            !timingSafeEqual(
              Buffer.from(request.challengeHash, 'hex'),
              Buffer.from(hash(verifier), 'hex'),
            )
          ) {
            throw new UnauthorizedException(INVALID_LINK);
          }
          if (!request.approvedByUserId) return null;
          const consumed = await tx.extensionLinkRequest.updateMany({
            where: { id: request.id, consumedAt: null, expiresAt: { gt: now } },
            data: { consumedAt: now },
          });
          if (consumed.count !== 1)
            throw new UnauthorizedException(INVALID_LINK);
          await tx.extensionObservationCredential.updateMany({
            where: { installationId: request.installationId, revokedAt: null },
            data: { revokedAt: now },
          });
          const authorization = await tx.extensionObservationCredential.create({
            data: {
              userId: request.approvedByUserId,
              installationId: request.installationId,
              extensionId,
              tokenHash: hash(credential),
              expiresAt: new Date(now.getTime() + CREDENTIAL_LIFETIME_MS),
            },
          });
          return {
            credential,
            expiresAt: authorization.expiresAt.toISOString(),
          };
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
      return result ?? { state: 'PENDING' as const };
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        (error.code === 'P2034' || error.code === 'P2002')
      ) {
        throw new UnauthorizedException(INVALID_LINK);
      }
      throw error;
    }
  }

  async authenticate(
    credential: string | undefined,
    extensionId: string,
  ): Promise<ExtensionIdentity> {
    if (!credential || !/^bcwx_[A-Za-z0-9_-]{43}$/.test(credential))
      throw new UnauthorizedException(INVALID_CREDENTIAL);
    const record = await this.prisma.extensionObservationCredential.findUnique({
      where: { tokenHash: hash(credential) },
      include: { user: { select: { emailVerifiedAt: true } } },
    });
    const now = new Date();
    if (
      !record ||
      record.extensionId !== extensionId ||
      record.revokedAt ||
      record.expiresAt <= now ||
      !record.user.emailVerifiedAt
    ) {
      throw new UnauthorizedException(INVALID_CREDENTIAL);
    }
    const used = await this.prisma.extensionObservationCredential.updateMany({
      where: { id: record.id, revokedAt: null, expiresAt: { gt: now } },
      data: { lastUsedAt: now },
    });
    if (used.count !== 1) throw new UnauthorizedException(INVALID_CREDENTIAL);
    return {
      userId: record.userId,
      authorizationId: record.id,
      expiresAt: record.expiresAt,
    };
  }

  async list(userId: string) {
    const records = await this.prisma.extensionObservationCredential.findMany({
      where: { userId, revokedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { createdAt: 'desc' },
      select: { id: true, createdAt: true, expiresAt: true, lastUsedAt: true },
    });
    return records.map((record) => ({
      id: record.id,
      createdAt: record.createdAt.toISOString(),
      expiresAt: record.expiresAt.toISOString(),
      lastUsedAt: record.lastUsedAt?.toISOString() ?? null,
    }));
  }

  async revoke(userId: string, authorizationId: string): Promise<void> {
    await this.prisma.extensionObservationCredential.updateMany({
      where: { id: authorizationId, userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }
}
