"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import {
  AuthShell,
  FormField,
  Notice,
  SubmitButton,
} from "../../components/auth-ui";
import { resendVerification, verifyEmail } from "../../lib/auth-api";
import { normalizeBtuEmail, takeEmailToken } from "../../lib/auth-validation";

export default function VerifyEmailPage() {
  const [token, setToken] = useState<string | null | undefined>(undefined);
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [verified, setVerified] = useState(false);
  const [resent, setResent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const initialized = useRef(false);

  useEffect(() => {
    if (initialized.current) return;
    initialized.current = true;
    setToken(
      takeEmailToken(window.location, (url) =>
        window.history.replaceState(null, "", url),
      ),
    );
  }, []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!token) return;
    setBusy(true);
    setError(null);
    try {
      await verifyEmail({ token });
      setToken(null);
      setVerified(true);
    } catch {
      setError(
        "This link is invalid, expired, or already used. Request a new one below.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function resend(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const normalized = normalizeBtuEmail(email);
    if (!normalized) {
      setError("Use your exact @btu.edu.ge email address.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await resendVerification({ email: normalized });
      setResent(true);
    } catch {
      setError("We could not submit that request. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthShell
      eyebrow="ONE MORE STEP"
      title="Verify your email"
      description="Email verification keeps your BTU Course Watch account tied to an address you control."
      footer={<Link href="/login">Back to sign in</Link>}
    >
      {verified && (
        <Notice kind="success">Email verified. You can now sign in.</Notice>
      )}
      {!verified && token === undefined && (
        <p role="status">Checking your link…</p>
      )}
      {!verified && token && (
        <form onSubmit={(event) => void submit(event)}>
          <p className="form-description">
            Ready to confirm your email address?
          </p>
          {error && <Notice kind="error">{error}</Notice>}
          <SubmitButton busy={busy}>Verify email</SubmitButton>
        </form>
      )}
      {!verified && token === null && (
        <Notice kind="info">
          No verification link was found. Enter your BTU email to request a new
          one.
        </Notice>
      )}
      {!verified && (
        <div className="secondary-form">
          <h2>Need a new link?</h2>
          <form onSubmit={(event) => void resend(event)}>
            <FormField
              id="email"
              label="BTU email"
              type="email"
              value={email}
              onChange={setEmail}
              autoComplete="email"
            />
            {resent && (
              <Notice kind="success">
                If eligible, a new link is on its way. You can request another
                after one minute.
              </Notice>
            )}
            {token === null && error && <Notice kind="error">{error}</Notice>}
            <SubmitButton busy={busy}>Resend verification</SubmitButton>
          </form>
        </div>
      )}
    </AuthShell>
  );
}
