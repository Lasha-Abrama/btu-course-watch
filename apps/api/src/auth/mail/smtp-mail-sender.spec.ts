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

  it('sends a historical availability message without a Choose URL or credentials', async () => {
    const sender = new SmtpMailSender(
      new ConfigService({
        CORS_ORIGIN: 'https://watch.example.test',
        NODE_ENV: 'production',
        SMTP_HOST: 'smtp.example.test',
        SMTP_PORT: 587,
        SMTP_SECURE: false,
        SMTP_FROM: 'no-reply@example.test',
      }),
    );
    await sender.sendGroupAvailability({
      to: 'student@btu.edu.ge',
      courseName: 'Synthetic course',
      groupName: 'Group 1',
      btuCourseId: 'synthetic-course',
      btuGroupId: 'synthetic-group',
      observedAt: new Date('2026-10-11T10:00:00.000Z'),
    });
    const message = smtp.sendMail.mock.calls[0]?.[0];
    expect(message).toMatchObject({
      to: 'student@btu.edu.ge',
      subject: 'A watched BTU group was observed available',
    });
    expect(message.text).toContain('Synthetic course');
    expect(message.text).toContain('Group 1');
    expect(message.text).toContain('2026-10-11T10:00:00.000Z');
    expect(message.text).toContain('https://watch.example.test/notifications');
    expect(message.text).toContain('Availability may have changed');
    expect(message.text).not.toMatch(/choose|cookie|token|classroom\.btu/i);
  });

  it('does not treat an SMTP response with zero accepted recipients as delivered', async () => {
    smtp.sendMail.mockResolvedValueOnce({ accepted: [] });
    const sender = new SmtpMailSender(
      new ConfigService({
        CORS_ORIGIN: 'https://watch.example.test',
        NODE_ENV: 'production',
        SMTP_HOST: 'smtp.example.test',
        SMTP_PORT: 587,
        SMTP_SECURE: false,
        SMTP_FROM: 'no-reply@example.test',
      }),
    );
    await expect(
      sender.sendGroupAvailability({
        to: 'student@btu.edu.ge',
        courseName: 'Synthetic course',
        groupName: 'Synthetic group',
        btuCourseId: 'synthetic-course',
        btuGroupId: 'synthetic-group',
        observedAt: new Date('2026-10-11T10:00:00.000Z'),
      }),
    ).rejects.toThrow('SMTP accepted no recipients');
  });
});
