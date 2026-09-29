import { createHash, randomBytes } from 'node:crypto';
import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { MAIL_SENDER, type MailSender } from './mail/mail-sender.js';
import { hashPassword } from './password.js';

const RESET_LIFETIME_MS = 30 * 60_000;
const RESEND_COOLDOWN_MS = 60_000;
const INVALID_TOKEN = 'Invalid or expired password reset token';

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function isSerializationConflict(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === 'P2034'
  );
}

@Injectable()
export class PasswordResetService {
  private readonly logger = new Logger(PasswordResetService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(MAIL_SENDER) private readonly mailSender: MailSender,
  ) {}

  async requestReset(email: string): Promise<void> {
    const now = new Date();
    const token = randomBytes(32).toString('base64url');
    const tokenHash = hashToken(token);
    const expiresAt = new Date(now.getTime() + RESET_LIFETIME_MS);

    try {
      const shouldSend = await this.prisma.$transaction(
        async (transaction) => {
          const user = await transaction.user.findUnique({
            where: { email },
            include: { passwordResetToken: true },
          });
          if (
            !user?.passwordHash ||
            !user.emailVerifiedAt ||
            (user.passwordResetToken &&
              user.passwordResetToken.sentAt >
                new Date(now.getTime() - RESEND_COOLDOWN_MS))
          )
            return false;

          await transaction.passwordResetToken.upsert({
            where: { userId: user.id },
            create: { userId: user.id, tokenHash, expiresAt, sentAt: now },
            update: { tokenHash, expiresAt, consumedAt: null, sentAt: now },
          });
          return true;
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
      if (shouldSend) {
        try {
          await this.mailSender.sendPasswordReset({
            to: email,
            token,
            expiresAt,
          });
        } catch {
          this.logger.warn('Could not send a password reset message');
        }
      }
    } catch (error) {
      // A concurrent request may have already replaced the token. Keep the
      // response identical to unknown, ineligible, and cooldown cases.
      if (isSerializationConflict(error)) return;
      throw error;
    }
  }

  async resetPassword(token: string, password: string): Promise<void> {
    // Do the expensive hash before the transaction to avoid holding a row lock.
    const passwordHash = await hashPassword(password);
    const tokenHash = hashToken(token);
    const now = new Date();
    try {
      await this.prisma.$transaction(
        async (transaction) => {
          const record = await transaction.passwordResetToken.findUnique({
            where: { tokenHash },
            include: { user: true },
          });
          if (
            !record ||
            record.consumedAt ||
            record.expiresAt <= now ||
            !record.user.passwordHash ||
            !record.user.emailVerifiedAt
          )
            throw new BadRequestException(INVALID_TOKEN);

          const consumed = await transaction.passwordResetToken.updateMany({
            where: {
              id: record.id,
              tokenHash,
              consumedAt: null,
              expiresAt: { gt: now },
            },
            data: { consumedAt: now },
          });
          if (consumed.count !== 1)
            throw new BadRequestException(INVALID_TOKEN);

          await transaction.user.update({
            where: { id: record.userId },
            data: { passwordHash },
          });
          await transaction.authSession.updateMany({
            where: { userId: record.userId, revokedAt: null },
            data: { revokedAt: now },
          });
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
    } catch (error) {
      if (isSerializationConflict(error))
        throw new BadRequestException(INVALID_TOKEN);
      throw error;
    }
  }
}
