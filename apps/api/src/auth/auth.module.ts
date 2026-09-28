import { Module } from '@nestjs/common';
import { AuthController } from './auth.controller.js';
import { AuthService } from './auth.service.js';
import { MAIL_SENDER } from './mail/mail-sender.js';
import { SmtpMailSender } from './mail/smtp-mail-sender.js';

@Module({
  controllers: [AuthController],
  providers: [
    AuthService,
    SmtpMailSender,
    { provide: MAIL_SENDER, useExisting: SmtpMailSender },
  ],
})
export class AuthModule {}
