import type {
  CurrentUserResponse,
  ForgotPasswordRequest,
  LoginRequest,
  RegisterRequest,
  ResetPasswordRequest,
  ResendVerificationRequest,
  VerifyEmailRequest,
} from "@btu-course-watch/contracts";
import { clientEnvironment } from "./env";

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

const baseUrl = clientEnvironment.NEXT_PUBLIC_API_URL.replace(/\/$/, "");
let refreshInFlight: Promise<boolean> | null = null;

async function request(
  path: string,
  method: "GET" | "POST",
  body?: unknown,
): Promise<Response> {
  const options: RequestInit = {
    method,
    credentials: "include",
    cache: "no-store",
  };
  if (body !== undefined) {
    options.headers = { "Content-Type": "application/json" };
    options.body = JSON.stringify(body);
  }
  return fetch(`${baseUrl}${path}`, options);
}

async function ensureOk(response: Response): Promise<void> {
  if (response.ok) return;
  let message = "Something went wrong. Please try again.";
  try {
    const data: unknown = await response.json();
    if (
      data &&
      typeof data === "object" &&
      "message" in data &&
      typeof data.message === "string"
    ) {
      message = data.message;
    }
  } catch {
    // A proxy or network intermediary may return a non-JSON response.
  }
  throw new ApiError(response.status, message);
}

async function post(path: string, body?: unknown): Promise<void> {
  await ensureOk(await request(path, "POST", body));
}

export function googleSignInUrl(): string {
  return `${baseUrl}/auth/google`;
}

export function login(input: LoginRequest): Promise<void> {
  return post("/auth/login", input);
}

export function register(input: RegisterRequest): Promise<void> {
  return post("/auth/register", input);
}

export function verifyEmail(input: VerifyEmailRequest): Promise<void> {
  return post("/auth/verify-email", input);
}

export function resendVerification(
  input: ResendVerificationRequest,
): Promise<void> {
  return post("/auth/resend-verification", input);
}

export function forgotPassword(input: ForgotPasswordRequest): Promise<void> {
  return post("/auth/forgot-password", input);
}

export function resetPassword(input: ResetPasswordRequest): Promise<void> {
  return post("/auth/reset-password", input);
}

export function logout(): Promise<void> {
  return post("/auth/logout");
}

async function refreshOnce(): Promise<boolean> {
  if (!refreshInFlight) {
    refreshInFlight = request("/auth/refresh", "POST")
      .then((response) => response.ok)
      .catch(() => false)
      .finally(() => {
        refreshInFlight = null;
      });
  }
  return refreshInFlight;
}

export async function getCurrentUser(): Promise<CurrentUserResponse | null> {
  let response = await request("/users/me", "GET");
  if (response.status === 401) {
    if (!(await refreshOnce())) return null;
    response = await request("/users/me", "GET");
    if (response.status === 401) return null;
  }
  await ensureOk(response);
  return response.json() as Promise<CurrentUserResponse>;
}
