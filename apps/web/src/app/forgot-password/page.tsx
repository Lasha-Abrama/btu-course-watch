"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import {
  AuthShell,
  FormField,
  Notice,
  SubmitButton,
} from "../../components/auth-ui";
import { forgotPassword } from "../../lib/auth-api";
import { normalizeBtuEmail } from "../../lib/auth-validation";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const normalized = normalizeBtuEmail(email);
    if (!normalized) {
      setError("Use your exact @btu.edu.ge email address.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await forgotPassword({ email: normalized });
      setSent(true);
    } catch {
      setError("We could not submit that request. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthShell
      eyebrow="ACCOUNT RECOVERY"
      title="Reset your password"
      description="Enter your BTU email and we’ll send a one-time reset link if this account is eligible."
      footer={<Link href="/login">Back to sign in</Link>}
    >
      {sent ? (
        <Notice kind="success">
          If eligible, a reset email is on its way. Check your inbox and spam
          folder. The link is valid for 30 minutes.
        </Notice>
      ) : (
        <form onSubmit={(event) => void submit(event)}>
          <FormField
            id="email"
            label="BTU email"
            type="email"
            value={email}
            onChange={setEmail}
            autoComplete="email"
          />
          {error && <Notice kind="error">{error}</Notice>}
          <SubmitButton busy={busy}>Send reset link</SubmitButton>
        </form>
      )}
      <p className="fine-print">
        Google-only accounts can continue signing in with Google. We never ask
        for BTU Classroom credentials.
      </p>
    </AuthShell>
  );
}
