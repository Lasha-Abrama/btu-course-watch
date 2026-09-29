import type { CourseObservation } from "@btu-course-watch/contracts";

const API = `${__BCW_API_ORIGIN__}/api/v1/extension`;
const WEB = __BCW_WEB_ORIGIN__;
const LINK_KEY = "courseWatchLink";
const INSTALLATION_KEY = "courseWatchInstallationId";

type Pending = { requestId: string; verifier: string; expiresAt: string };
type Credential = { value: string; expiresAt: string };
type SavedLink = { pending?: Pending; credential?: Credential };
export type LinkState =
  | { state: "NOT_LINKED" }
  | { state: "PENDING"; pairingCode: string; expiresAt: string }
  | { state: "LINKED"; expiresAt: string };
export type SubmissionResult =
  | { state: "SUBMITTED" }
  | { state: "NOT_LINKED" }
  | { state: "AUTH_REQUIRED" }
  | { state: "SUBMISSION_FAILED" };

type Storage = {
  get(key: string): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
  remove(key: string): Promise<void>;
};

function headers(credential?: string): HeadersInit {
  return {
    "Content-Type": "application/json",
    "X-BCW-Extension-Id": chrome.runtime.id,
    ...(credential ? { Authorization: `Bearer ${credential}` } : {}),
  };
}

async function saved(storage: Storage): Promise<SavedLink> {
  const data = await storage.get(LINK_KEY);
  const value = data[LINK_KEY];
  return value && typeof value === "object" ? (value as SavedLink) : {};
}

async function installationId(storage: Storage): Promise<string> {
  const data = await storage.get(INSTALLATION_KEY);
  if (typeof data[INSTALLATION_KEY] === "string") return data[INSTALLATION_KEY];
  const id = crypto.randomUUID();
  await storage.set({ [INSTALLATION_KEY]: id });
  return id;
}

async function post(
  path: string,
  body: unknown,
  credential?: string,
  fetcher: typeof fetch = fetch,
): Promise<Response> {
  return fetcher(`${API}${path}`, {
    method: "POST",
    credentials: "omit",
    cache: "no-store",
    redirect: "error",
    headers: headers(credential),
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15_000),
  });
}

export async function startLink(
  storage: Storage = chrome.storage.local,
  fetcher: typeof fetch = fetch,
): Promise<{ pairingCode: string; expiresAt: string; url: string }> {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  const verifier = btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=/g, "");
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(verifier),
  );
  const challengeHash = Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
  const response = await post(
    "/link-requests",
    { installationId: await installationId(storage), challengeHash },
    undefined,
    fetcher,
  );
  if (!response.ok) throw new Error("LINK_FAILED");
  const data = (await response.json()) as {
    requestId: string;
    expiresAt: string;
  };
  if (!/^[0-9a-f-]{36}$/i.test(data.requestId)) throw new Error("LINK_FAILED");
  await storage.set({
    [LINK_KEY]: {
      pending: {
        requestId: data.requestId,
        verifier,
        expiresAt: data.expiresAt,
      },
    },
  });
  return {
    pairingCode: data.requestId.slice(-6).toUpperCase(),
    expiresAt: data.expiresAt,
    url: `${WEB}/extension-link?requestId=${encodeURIComponent(data.requestId)}`,
  };
}

export async function linkStatus(
  storage: Storage = chrome.storage.local,
  fetcher: typeof fetch = fetch,
): Promise<LinkState> {
  const link = await saved(storage);
  if (link.credential) {
    if (Date.parse(link.credential.expiresAt) <= Date.now()) {
      await storage.remove(LINK_KEY);
      return { state: "NOT_LINKED" };
    }
    try {
      const response = await fetcher(`${API}/status`, {
        credentials: "omit",
        cache: "no-store",
        redirect: "error",
        headers: headers(link.credential.value),
        signal: AbortSignal.timeout(15_000),
      });
      if (response.ok)
        return { state: "LINKED", expiresAt: link.credential.expiresAt };
      if (response.status === 401 || response.status === 403) {
        await storage.remove(LINK_KEY);
        return { state: "NOT_LINKED" };
      }
    } catch {
      // A network failure does not revoke a still-valid local authorization.
    }
    return { state: "LINKED", expiresAt: link.credential.expiresAt };
  }
  if (!link.pending) return { state: "NOT_LINKED" };
  if (Date.parse(link.pending.expiresAt) <= Date.now()) {
    await storage.remove(LINK_KEY);
    return { state: "NOT_LINKED" };
  }
  const response = await post(
    `/link-requests/${link.pending.requestId}/exchange`,
    { verifier: link.pending.verifier },
    undefined,
    fetcher,
  );
  if (response.status === 401 || response.status === 403) {
    await storage.remove(LINK_KEY);
    return { state: "NOT_LINKED" };
  }
  if (!response.ok) throw new Error("LINK_FAILED");
  const data = (await response.json()) as
    { state: "PENDING" } | { credential: string; expiresAt: string };
  if ("state" in data && data.state === "PENDING")
    return {
      state: "PENDING",
      pairingCode: link.pending.requestId.slice(-6).toUpperCase(),
      expiresAt: link.pending.expiresAt,
    };
  if (
    !("credential" in data) ||
    !/^bcwx_[A-Za-z0-9_-]{43}$/.test(data.credential)
  )
    throw new Error("LINK_FAILED");
  await storage.set({
    [LINK_KEY]: {
      credential: { value: data.credential, expiresAt: data.expiresAt },
    },
  });
  return { state: "LINKED", expiresAt: data.expiresAt };
}

export async function submitObservation(
  observation: CourseObservation,
  storage: Storage = chrome.storage.local,
  fetcher: typeof fetch = fetch,
): Promise<SubmissionResult> {
  const credential = (await saved(storage)).credential;
  if (!credential) return { state: "NOT_LINKED" };
  if (Date.parse(credential.expiresAt) <= Date.now()) {
    await storage.remove(LINK_KEY);
    return { state: "AUTH_REQUIRED" };
  }
  try {
    const response = await post(
      "/observations",
      observation,
      credential.value,
      fetcher,
    );
    if (response.ok) return { state: "SUBMITTED" };
    if (response.status === 401 || response.status === 403) {
      await storage.remove(LINK_KEY);
      return { state: "AUTH_REQUIRED" };
    }
  } catch {
    // No server response means the local observation is still useful.
  }
  return { state: "SUBMISSION_FAILED" };
}
