import { ConfigService } from '@nestjs/config';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SmtpMailSender } from './smtp-mail-sender.js';

const smtp = vi.hoisted(() => ({
  createTransport: vi.fn(),
  sendMail: vi.fn(),
}));

vi.mock('nodemailer', () => ({
  default: { createTransport: smtp.createTransport },
}));

describe('SmtpMailSender', () => {
  beforeEach(() => {
    smtp.createTransport.mockReset();
    smtp.sendMail.mockReset();
    smtp.createTransport.mockReturnValue({ sendMail: smtp.sendMail });
    smtp.sendMail.mockResolvedValue(undefined);
  });

  it('uses validated SMTP settings and sends the token only through email', async () => {
    const config = new ConfigService({
      API_PUBLIC_URL: 'https://api.example.test',
      CORS_ORIGIN: 'https://watch.example.test',
      NODE_ENV: 'production',
      SMTP_HOST: 'smtp.example.test',
      SMTP_PORT: 587,
      SMTP_SECURE: false,
      SMTP_FROM: 'no-reply@example.test',
      SMTP_USER: 'mail-user',
      SMTP_PASSWORD: 'mail-password',
    });
    const sender = new SmtpMailSender(config);
    const expiresAt = new Date('2026-09-29T12:00:00.000Z');

    await sender.sendEmailVerification({
      to: 'student@btu.edu.ge',
      token: 'one-time-token',
      expiresAt,
    });

    expect(smtp.createTransport).toHaveBeenCalledWith(
      expect.objectContaining({
        host: 'smtp.example.test',
        port: 587,
        secure: false,
        requireTLS: true,
        auth: { user: 'mail-user', pass: 'mail-password' },
        disableFileAccess: true,
        disableUrlAccess: true,
      }),
    );
    expect(smtp.sendMail).toHaveBeenCalledWith(
      expect.objectContaining({
        from: 'no-reply@example.test',
        to: 'student@btu.edu.ge',
        text: expect.stringContaining('one-time-token'),
      }),
    );
    expect(smtp.sendMail.mock.calls[0]?.[0].text).toContain(
      'https://watch.example.test/verify-email#token=one-time-token',
    );
    expect(smtp.sendMail.mock.calls[0]?.[0].text).not.toContain(
      'api.example.test',
    );

    await sender.sendPasswordReset({
      to: 'student@btu.edu.ge',
      token: 'reset-token',
      expiresAt,
    });
    expect(smtp.sendMail.mock.calls[1]?.[0]).toEqual(
      expect.objectContaining({
        subject: 'Reset your BTU Course Watch password',
        text: expect.stringContaining(
          'https://watch.example.test/reset-password#token=reset-token',
        ),
      }),
    );
  });
});
