"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import {
  AuthShell,
  FormField,
  Notice,
  SubmitButton,
} from "../../components/auth-ui";
import { resetPassword } from "../../lib/auth-api";
import { passwordHint, takeEmailToken } from "../../lib/auth-validation";
import { useAuthSession } from "../../components/auth-session";

export default function ResetPasswordPage() {
  const { recheck } = useAuthSession();
  const [token, setToken] = useState<string | null | undefined>(undefined);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
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
    const hint = passwordHint(password);
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
      await resetPassword({ token, password });
      setToken(null);
      setPassword("");
      setConfirm("");
      setDone(true);
      void recheck();
    } catch {
      setError(
        "This link is invalid, expired, or already used. Request another reset link.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthShell
      eyebrow="ACCOUNT RECOVERY"
      title="Choose a new password"
      description="A strong, unique password helps keep your BTU Course Watch account secure."
      footer={
        <>
          <Link href="/forgot-password">Request another link</Link> ·{" "}
          <Link href="/login">Sign in</Link>
        </>
      }
    >
      {done && (
        <Notice kind="success">
          Password changed. All previous sessions have been signed out. Please
          sign in again.
        </Notice>
      )}
      {!done && token === undefined && <p role="status">Checking your link…</p>}
      {!done && token === null && (
        <Notice kind="error">
          No valid reset link was found. Request a new one.
        </Notice>
      )}
      {!done && token && (
        <form onSubmit={(event) => void submit(event)}>
          <FormField
            id="password"
            label="New password"
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
            label="Confirm new password"
            type="password"
            value={confirm}
            onChange={setConfirm}
            autoComplete="new-password"
          />
          {error && <Notice kind="error">{error}</Notice>}
          <SubmitButton busy={busy}>Reset password</SubmitButton>
        </form>
      )}
    </AuthShell>
  );
}
