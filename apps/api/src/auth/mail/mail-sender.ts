export const MAIL_SENDER = Symbol('MAIL_SENDER');

export interface VerificationMessage {
  to: string;
  token: string;
  expiresAt: Date;
}

export interface AvailabilityMessage {
  to: string;
  courseName: string | null;
  groupName: string | null;
  btuCourseId: string;
  btuGroupId: string;
  observedAt: Date;
}

export interface MailSender {
  sendEmailVerification(message: VerificationMessage): Promise<void>;
  sendPasswordReset(message: VerificationMessage): Promise<void>;
  sendGroupAvailability(message: AvailabilityMessage): Promise<void>;
}
