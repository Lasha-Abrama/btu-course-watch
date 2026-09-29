import { createHash, randomBytes } from 'node:crypto';
import {
  Inject,
  Injectable,
  Logger,
  BadRequestException,
  UnauthorizedException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import * as argon2 from 'argon2';
import { PrismaService } from '../prisma/prisma.service.js';
import { MAIL_SENDER, type MailSender } from './mail/mail-sender.js';
import { hashPassword } from './password.js';
import { SessionService, type SessionTokens } from './session.service.js';

const TOKEN_LIFETIME_MS = 24 * 60 * 60 * 1_000;
const RESEND_COOLDOWN_MS = 60 * 1_000;
const INVALID_TOKEN_MESSAGE = 'Invalid or expired verification token';
const DUMMY_PASSWORD_HASH = argon2.hash('unused login timing reference', {
  type: argon2.argon2id,
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
});

function createVerificationToken(): { token: string; tokenHash: string } {
  const token = randomBytes(32).toString('base64url');

  return {
    token,
    tokenHash: createHash('sha256').update(token).digest('hex'),
  };
}

function isPrismaError(error: unknown, code: string): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError && error.code === code
  );
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(MAIL_SENDER) private readonly mailSender: MailSender,
    private readonly sessions: SessionService,
  ) {}

  async login(email: string, password: string): Promise<SessionTokens> {
    const user = await this.prisma.user.findUnique({ where: { email } });
    const valid = await argon2.verify(
      user?.passwordHash ?? (await DUMMY_PASSWORD_HASH),
      password,
    );
    if (!valid || !user?.emailVerifiedAt) {
      throw new UnauthorizedException('Invalid credentials');
    }
    return this.sessions.createSession(user.id);
  }

  async register(email: string, password: string): Promise<void> {
    const passwordHash = await hashPassword(password);
    const { token, tokenHash } = createVerificationToken();
    const expiresAt = new Date(Date.now() + TOKEN_LIFETIME_MS);

    try {
      await this.prisma.user.create({
        data: {
          email,
          passwordHash,
          emailVerificationToken: {
            create: { tokenHash, expiresAt },
          },
        },
      });
    } catch (error) {
      if (isPrismaError(error, 'P2002')) return;
      throw error;
    }

    await this.sendVerification(email, token, expiresAt);
  }

  async verifyEmail(token: string): Promise<void> {
    const tokenHash = createHash('sha256').update(token).digest('hex');
    const now = new Date();

    try {
      await this.prisma.$transaction(
        async (transaction) => {
          const record = await transaction.emailVerificationToken.findUnique({
            where: { tokenHash },
          });

          if (!record || record.consumedAt || record.expiresAt <= now) {
            throw new BadRequestException(INVALID_TOKEN_MESSAGE);
          }

          const consumed = await transaction.emailVerificationToken.updateMany({
            where: {
              id: record.id,
              tokenHash,
              consumedAt: null,
              expiresAt: { gt: now },
            },
            data: { consumedAt: now },
          });
          if (consumed.count !== 1) {
            throw new BadRequestException(INVALID_TOKEN_MESSAGE);
          }

          const verified = await transaction.user.updateMany({
            where: { id: record.userId, emailVerifiedAt: null },
            data: { emailVerifiedAt: now },
          });
          if (verified.count !== 1) {
            throw new BadRequestException(INVALID_TOKEN_MESSAGE);
          }
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
    } catch (error) {
      if (isPrismaError(error, 'P2034')) {
        throw new BadRequestException(INVALID_TOKEN_MESSAGE);
      }
      throw error;
    }
  }

  async resendVerification(email: string): Promise<void> {
    const now = new Date();
    const cooldownBefore = new Date(now.getTime() - RESEND_COOLDOWN_MS);
    const { token, tokenHash } = createVerificationToken();
    const expiresAt = new Date(now.getTime() + TOKEN_LIFETIME_MS);

    try {
      const shouldSend = await this.prisma.$transaction(
        async (transaction) => {
          const user = await transaction.user.findUnique({
            where: { email },
            include: { emailVerificationToken: true },
          });

          if (
            !user ||
            user.emailVerifiedAt ||
            (user.emailVerificationToken &&
              user.emailVerificationToken.sentAt > cooldownBefore)
          ) {
            return false;
          }

          await transaction.emailVerificationToken.upsert({
            where: { userId: user.id },
            create: { userId: user.id, tokenHash, expiresAt, sentAt: now },
            update: {
              tokenHash,
              expiresAt,
              consumedAt: null,
              sentAt: now,
            },
          });
          return true;
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );

      if (shouldSend) {
        await this.sendVerification(email, token, expiresAt);
      }
    } catch (error) {
      if (isPrismaError(error, 'P2034')) return;
      throw error;
    }
  }

  private async sendVerification(
    email: string,
    token: string,
    expiresAt: Date,
  ): Promise<void> {
    try {
      await this.mailSender.sendEmailVerification({
        to: email,
        token,
        expiresAt,
      });
    } catch {
      // Keep account existence and SMTP details out of public responses.
      this.logger.warn('Could not send an email verification message');
    }
  }
}
