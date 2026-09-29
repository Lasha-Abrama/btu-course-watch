"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAuthSession } from "../components/auth-session";
import { Notice } from "../components/auth-ui";

export default function Home() {
  const router = useRouter();
  const { user, loading, error, recheck, signOut } = useAuthSession();
  const [logoutError, setLogoutError] = useState(false);
  const [busy, setBusy] = useState(false);

  async function logout() {
    setBusy(true);
    setLogoutError(false);
    try {
      await signOut();
      router.replace("/login");
    } catch {
      setLogoutError(true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="landing">
      <header className="landing-header">
        <span className="landing-brand">
          <span className="brand-mark">
            B<span>.</span>
          </span>
          BTU Course Watch
        </span>
        <nav aria-label="Account">
          {user && (
            <button
              type="button"
              className="text-button"
              onClick={() => void logout()}
              disabled={busy}
            >
              {busy ? "Signing out…" : "Sign out"}
            </button>
          )}
          {!user && !loading && <Link href="/login">Sign in</Link>}
        </nav>
      </header>
      <section className="landing-hero">
        <p className="form-eyebrow">FOR THE BTU COMMUNITY</p>
        <h1>
          Your course plans deserve a clearer view<span>.</span>
        </h1>
        <p>
          BTU Course Watch account access is ready. Course availability
          monitoring is coming in a future phase.
        </p>
        {loading && <p role="status">Checking your session…</p>}
        {error && (
          <Notice kind="error">
            {error}{" "}
            <button type="button" onClick={() => void recheck()}>
              Try again
            </button>
          </Notice>
        )}
        {!loading && !error && user && (
          <div className="session-card">
            <span className="session-dot" />
            Signed in as <strong>{user.email}</strong>
            <p>Your account is ready. Course monitoring is not live yet.</p>
          </div>
        )}
        {!loading && !error && !user && (
          <div className="landing-actions">
            <Link className="primary-button" href="/register">
              Create an account
            </Link>
            <Link className="secondary-button" href="/login">
              Sign in
            </Link>
          </div>
        )}
        {logoutError && (
          <Notice kind="error">Could not sign out. Please try again.</Notice>
        )}
      </section>
      <footer className="landing-footer">
        Independent from BTU Classroom. We never request its credentials.
      </footer>
    </main>
  );
}
