/** Response returned by the API health endpoint. */
export interface HealthResponse {
  status: "ok";
  service: "btu-course-watch-api";
  timestamp: string;
}

export interface RegisterRequest {
  email: string;
  password: string;
}

export interface VerifyEmailRequest {
  token: string;
}

export interface ResendVerificationRequest {
  email: string;
}

export interface AuthAcceptedResponse {
  message: "If eligible, a verification email will be sent.";
}

export interface EmailVerifiedResponse {
  message: "Email verified.";
}

export interface LoginRequest {
  email: string;
  password: string;
}

export interface CurrentUserResponse {
  id: string;
  email: string;
  emailVerifiedAt: string;
}

export interface ForgotPasswordRequest {
  email: string;
}

export interface PasswordResetAcceptedResponse {
  message: "If eligible, a password reset email will be sent.";
}

export interface ResetPasswordRequest {
  token: string;
  password: string;
}

export interface PasswordResetResponse {
  message: "Password reset. Please sign in again.";
}

export {
  assertCourseObservation,
  isBtuChooseUrl,
  type CourseObservation,
  type GroupObservation,
  type GroupAvailabilityStatus,
} from "./course-observation.js";
