import { Module } from '@nestjs/common';
import { PassportModule } from '@nestjs/passport';
import { AuthController } from './auth.controller.js';
import { AuthService } from './auth.service.js';
import { MAIL_SENDER } from './mail/mail-sender.js';
import { SmtpMailSender } from './mail/smtp-mail-sender.js';
import { SessionService } from './session.service.js';
import { SessionGuard } from './session.guard.js';
import { UsersController } from './users.controller.js';
import { GoogleController } from './google.controller.js';
import { GoogleIdentityService } from './google-identity.service.js';
import { GoogleOAuthGuard } from './google-oauth.guard.js';
import { GoogleOAuthStateStore } from './google-oauth-state.store.js';
import { GoogleStrategy } from './google.strategy.js';
import { PasswordResetService } from './password-reset.service.js';

@Module({
  imports: [PassportModule.register({ session: false })],
  controllers: [AuthController, GoogleController, UsersController],
  providers: [
    AuthService,
    PasswordResetService,
    SessionService,
    SessionGuard,
    GoogleIdentityService,
    GoogleOAuthGuard,
    GoogleOAuthStateStore,
    GoogleStrategy,
    SmtpMailSender,
    { provide: MAIL_SENDER, useExisting: SmtpMailSender },
  ],
})
export class AuthModule {}
