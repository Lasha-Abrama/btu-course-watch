import type { GroupAvailabilityStatus } from "./course-observation.js";

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

/** Counts for one accepted structured observation; no submitting-user data. */
export interface ObservationIngestionResponse {
  btuCourseId: string;
  groupsCreated: number;
  groupsUpdated: number;
  groupsSkipped: number;
  discoveryEventsCreated: number;
  statusChangesCreated: number;
}

/** Shared canonical state is last-known state, not a promise of live availability. */
export interface CanonicalCourseResponse {
  btuCourseId: string;
  name: string | null;
  lastObservedAt: string;
  groups: Array<{
    btuGroupId: string;
    name: string | null;
    capacity: number | null;
    status: GroupAvailabilityStatus;
    firstObservedAt: string;
    lastObservedAt: string;
    chooseUrlPresent: boolean;
  }>;
  recentChanges: Array<{
    btuGroupId: string;
    kind: "DISCOVERED" | "STATUS_CHANGED";
    previousStatus: GroupAvailabilityStatus | null;
    status: GroupAvailabilityStatus;
    observedAt: string;
  }>;
}

export {
  assertCourseObservation,
  isBtuChooseUrl,
  type CourseObservation,
  type GroupObservation,
  type GroupAvailabilityStatus,
} from "./course-observation.js";
