"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import {
  AuthShell,
  FormField,
  Notice,
  SubmitButton,
} from "../../components/auth-ui";
import { register } from "../../lib/auth-api";
import { normalizeBtuEmail, passwordHint } from "../../lib/auth-validation";

export default function RegisterPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const normalized = normalizeBtuEmail(email);
    const hint = passwordHint(password);
    if (!normalized) {
      setError("Use your exact @btu.edu.ge email address.");
      return;
    }
    if (hint) {
      setError(hint);
      return;
    }
    if (password !== confirm) {
      setError("The passwords do not match.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await register({ email: normalized, password });
      setPassword("");
      setConfirm("");
      setSent(true);
    } catch {
      setError("We could not submit your registration. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthShell
      eyebrow="GET STARTED"
      title="Create your account"
      description="Register with your BTU email. We’ll email a verification link before you can sign in."
      footer={
        <>
          Already have an account? <Link href="/login">Sign in</Link>
        </>
      }
    >
      {sent ? (
        <Notice kind="success">
          If eligible, a verification email is on its way. Open its link to
          activate your account. Check spam if it does not arrive.
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
            hint="Only addresses ending exactly in @btu.edu.ge are eligible."
          />
          <FormField
            id="password"
            label="Password"
            type="password"
            value={password}
            onChange={setPassword}
            autoComplete="new-password"
            minLength={12}
            maxLength={128}
            hint="12–128 characters with three character types, or a 20+ character passphrase with three words."
          />
          <FormField
            id="confirm"
            label="Confirm password"
            type="password"
            value={confirm}
            onChange={setConfirm}
            autoComplete="new-password"
          />
          {error && <Notice kind="error">{error}</Notice>}
          <SubmitButton busy={busy}>Create account</SubmitButton>
        </form>
      )}
      <p className="fine-print">
        This password is for BTU Course Watch only. Never use or share BTU
        Classroom credentials here.
      </p>
    </AuthShell>
  );
}
