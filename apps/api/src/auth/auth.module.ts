import { Module } from '@nestjs/common';
import { AuthController } from './auth.controller.js';
import { AuthService } from './auth.service.js';
import { MAIL_SENDER } from './mail/mail-sender.js';
import { SmtpMailSender } from './mail/smtp-mail-sender.js';
import { SessionService } from './session.service.js';
import { SessionGuard } from './session.guard.js';
import { UsersController } from './users.controller.js';

@Module({
  controllers: [AuthController, UsersController],
  providers: [
    AuthService,
    SessionService,
    SessionGuard,
    SmtpMailSender,
    { provide: MAIL_SENDER, useExisting: SmtpMailSender },
  ],
})
export class AuthModule {}
