"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { AuthShell, Notice } from "../../components/auth-ui";
import { useAuthSession } from "../../components/auth-session";
import {
  approveExtensionLinkRequest,
  getExtensionLinkRequest,
  listExtensionAuthorizations,
  revokeExtensionAuthorization,
  type ExtensionAuthorization,
  type ExtensionLinkRequest,
} from "../../lib/auth-api";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default function ExtensionLinkPage() {
  const { user, loading, recheck } = useAuthSession();
  const [requestId, setRequestId] = useState<string | null>(null);
  const [invalid, setInvalid] = useState(false);
  const [requestInfo, setRequestInfo] = useState<ExtensionLinkRequest | null>(
    null,
  );
  const [authorizations, setAuthorizations] = useState<
    ExtensionAuthorization[]
  >([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  useEffect(() => {
    const values = new URLSearchParams(window.location.search);
    const id = values.get("requestId");
    if (values.size > (id ? 1 : 0) || (id && !UUID.test(id))) setInvalid(true);
    else setRequestId(id);
  }, []);

  const load = useCallback(async () => {
    if (!user || invalid) return;
    setError(null);
    try {
      if (requestId) setRequestInfo(await getExtensionLinkRequest(requestId));
      else setAuthorizations(await listExtensionAuthorizations());
    } catch {
      setError("This authorization is unavailable or has expired.");
    }
  }, [user, invalid, requestId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function approve() {
    if (!requestId) return;
    setBusy(true);
    setError(null);
    try {
      await approveExtensionLinkRequest(requestId);
      setDone(true);
      await load();
    } catch {
      setError(
        "Could not authorize this request. Start a new link from the extension.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function revoke(id: string) {
    setBusy(true);
    setError(null);
    try {
      await revokeExtensionAuthorization(id);
      await load();
    } catch {
      setError("Could not revoke this authorization. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthShell
      eyebrow="ACCOUNT SECURITY"
      title={requestId ? "Connect your extension" : "Extension access"}
      description="Authorize only this Course Watch browser extension to submit structured course observations. It never shares your BTU Classroom session with us."
      footer={<Link href="/">Back to your account</Link>}
    >
      {invalid && (
        <Notice kind="error">
          Invalid authorization link. Start again from the extension.
        </Notice>
      )}
      {loading && <p role="status">Checking your account…</p>}
      {!loading && !user && !invalid && (
        <div className="extension-panel">
          <p>
            Sign in to your Course Watch account in another tab, then return
            here and check again.
          </p>
          <a
            className="primary-button"
            href="/login"
            target="_blank"
            rel="noopener noreferrer"
          >
            Open sign in
          </a>
          <button
            className="secondary-button"
            type="button"
            onClick={() => void recheck()}
          >
            Check account
          </button>
        </div>
      )}
      {user && !invalid && requestId && (
        <div className="extension-panel">
          <p>
            Signed in as <strong>{user.email}</strong>. Compare this code with
            the extension popup before approving:
          </p>
          {requestInfo && (
            <p className="pairing-code" aria-label="Pairing code">
              {requestInfo.pairingCode}
            </p>
          )}
          <p>
            Access is limited to submitting structured observations and expires
            after 90 days. You can revoke it here later.
          </p>
          {done || requestInfo?.approved ? (
            <Notice kind="success">
              Authorized. Return to the extension and choose Check
              authorization.
            </Notice>
          ) : (
            <button
              className="primary-button"
              type="button"
              disabled={busy || !requestInfo}
              onClick={() => void approve()}
            >
              {busy ? "Authorizing…" : "Authorize this extension"}
            </button>
          )}
        </div>
      )}
      {user && !invalid && !requestId && (
        <div className="extension-panel">
          <p>
            Connected extension installations for <strong>{user.email}</strong>.
          </p>
          {authorizations.length === 0 && (
            <p>No active extension authorizations.</p>
          )}
          <ul className="extension-authorizations">
            {authorizations.map((item) => (
              <li key={item.id}>
                <span>
                  Authorized {new Date(item.createdAt).toLocaleDateString()} ·
                  Expires {new Date(item.expiresAt).toLocaleDateString()}
                </span>
                <button
                  className="text-button"
                  type="button"
                  disabled={busy}
                  onClick={() => void revoke(item.id)}
                >
                  Revoke
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
      {error && <Notice kind="error">{error}</Notice>}
      <p className="fine-print">
        Linking grants access only to the Course Watch API. Never enter BTU
        Classroom credentials here.
      </p>
    </AuthShell>
  );
}
