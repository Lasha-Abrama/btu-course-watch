import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import nodemailer, { type Transporter } from 'nodemailer';
import type { MailSender, VerificationMessage } from './mail-sender.js';

@Injectable()
export class SmtpMailSender implements MailSender {
  private readonly transporter: Transporter;
  private readonly sender: string;
  private readonly frontendOrigin: string;

  constructor(config: ConfigService) {
    const username = config.get<string>('SMTP_USER');
    const password = config.get<string>('SMTP_PASSWORD');
    const secure = config.getOrThrow<boolean>('SMTP_SECURE');

    this.transporter = nodemailer.createTransport({
      host: config.getOrThrow<string>('SMTP_HOST'),
      port: config.getOrThrow<number>('SMTP_PORT'),
      secure,
      requireTLS:
        config.getOrThrow<string>('NODE_ENV') === 'production' && !secure,
      connectionTimeout: 10_000,
      greetingTimeout: 10_000,
      socketTimeout: 20_000,
      tls: { minVersion: 'TLSv1.2' },
      auth:
        username && password ? { user: username, pass: password } : undefined,
      disableFileAccess: true,
      disableUrlAccess: true,
    });
    this.sender = config.getOrThrow<string>('SMTP_FROM');
    this.frontendOrigin = config.getOrThrow<string>('CORS_ORIGIN');
  }

  private link(
    path: '/verify-email' | '/reset-password',
    token: string,
  ): string {
    // URL fragments are never sent to the frontend server in HTTP requests.
    const destination = new URL(path, this.frontendOrigin);
    destination.hash = new URLSearchParams({ token }).toString();
    return destination.toString();
  }

  async sendEmailVerification({
    to,
    token,
    expiresAt,
  }: VerificationMessage): Promise<void> {
    await this.transporter.sendMail({
      from: this.sender,
      to,
      subject: 'Verify your BTU Course Watch email',
      text: [
        'Verify your BTU Course Watch email using this one-time link:',
        this.link('/verify-email', token),
        '',
        `It expires at ${expiresAt.toISOString()}.`,
        'If you did not register, you can ignore this message.',
      ].join('\n'),
    });
  }

  async sendPasswordReset({
    to,
    token,
    expiresAt,
  }: VerificationMessage): Promise<void> {
    await this.transporter.sendMail({
      from: this.sender,
      to,
      subject: 'Reset your BTU Course Watch password',
      text: [
        'Reset your BTU Course Watch password using this one-time link:',
        this.link('/reset-password', token),
        '',
        `It expires at ${expiresAt.toISOString()}.`,
        'If you did not request this, you can ignore this message. Your password has not changed.',
      ].join('\n'),
    });
  }
}
