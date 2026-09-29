"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  AuthShell,
  FormField,
  Notice,
  SubmitButton,
} from "../../components/auth-ui";
import { useAuthSession } from "../../components/auth-session";
import { googleSignInUrl } from "../../lib/auth-api";
import { normalizeBtuEmail } from "../../lib/auth-validation";

export default function LoginPage() {
  const router = useRouter();
  const { signIn } = useAuthSession();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
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
      await signIn({ email: normalized, password });
      router.replace("/");
    } catch {
      setError(
        "Could not sign in. Check your details and confirm your email, then try again.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthShell
      eyebrow="WELCOME BACK"
      title="Sign in to your account"
      description="Use your BTU Course Watch account to continue."
      footer={
        <>
          New here? <Link href="/register">Create an account</Link>
        </>
      }
    >
      <a className="google-button" href={googleSignInUrl()}>
        <span className="google-g" aria-hidden="true">
          G
        </span>
        Continue with Google
      </a>
      <p className="separator">
        <span>or with email</span>
      </p>
      <form onSubmit={(event) => void submit(event)}>
        <FormField
          id="email"
          label="BTU email"
          type="email"
          value={email}
          onChange={setEmail}
          autoComplete="email"
        />
        <FormField
          id="password"
          label="Password"
          type="password"
          value={password}
          onChange={setPassword}
          autoComplete="current-password"
        />
        <div className="form-small-link">
          <Link href="/forgot-password">Forgot password?</Link>
        </div>
        {error && <Notice kind="error">{error}</Notice>}
        <SubmitButton busy={busy}>Sign in</SubmitButton>
      </form>
      <p className="fine-print">
        Your account is separate from BTU Classroom. Never enter your Classroom
        password here.
      </p>
    </AuthShell>
  );
}
