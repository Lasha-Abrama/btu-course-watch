export const MAIL_SENDER = Symbol('MAIL_SENDER');

export interface VerificationMessage {
  to: string;
  token: string;
  expiresAt: Date;
}

export interface MailSender {
  sendEmailVerification(message: VerificationMessage): Promise<void>;
}
