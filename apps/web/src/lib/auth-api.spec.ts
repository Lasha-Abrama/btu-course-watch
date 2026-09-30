import { afterEach, describe, expect, it, vi } from "vitest";
import {
  approveExtensionLinkRequest,
  getCurrentUser,
  getExtensionLinkRequest,
  login,
  logout,
  register,
  revokeExtensionAuthorization,
  listWatches,
  removeWatch,
} from "./auth-api";

const profile = {
  id: "user-id",
  email: "student@btu.edu.ge",
  emailVerifiedAt: "2026-09-29T00:00:00.000Z",
};

afterEach(() => vi.unstubAllGlobals());

describe("cookie-based frontend auth client", () => {
  it("includes credentials for login, registration and logout without reading tokens", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetcher);
    await login({ email: profile.email, password: "valid passphrase" });
    await register({ email: profile.email, password: "valid passphrase" });
    await logout();
    expect(fetcher).toHaveBeenCalledTimes(3);
    for (const [, options] of fetcher.mock.calls) {
      expect(options.credentials).toBe("include");
      expect(options.cache).toBe("no-store");
    }
    expect(fetcher.mock.calls[0]?.[0]).toBe(
      "http://localhost:3001/api/v1/auth/login",
    );
    expect(fetcher.mock.calls[2]?.[0]).toBe(
      "http://localhost:3001/api/v1/auth/logout",
    );
  });

  it("coalesces concurrent refreshes and retries each profile request only once", async () => {
    let meCalls = 0;
    let refreshCalls = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, options: RequestInit) => {
        expect(options.credentials).toBe("include");
        if (url.endsWith("/users/me")) {
          meCalls++;
          return meCalls <= 2
            ? new Response(null, { status: 401 })
            : Response.json(profile);
        }
        if (url.endsWith("/auth/refresh")) {
          refreshCalls++;
          await Promise.resolve();
          return new Response(null, { status: 204 });
        }
        throw new Error("Unexpected request");
      }),
    );
    const result = await Promise.all([getCurrentUser(), getCurrentUser()]);
    expect(result).toEqual([profile, profile]);
    expect(refreshCalls).toBe(1);
    expect(meCalls).toBe(4);
  });

  it("does not loop when refresh or the one retry fails", async () => {
    let meCalls = 0;
    let refreshCalls = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url.endsWith("/users/me")) {
          meCalls++;
          return new Response(null, { status: 401 });
        }
        refreshCalls++;
        return new Response(null, { status: 204 });
      }),
    );
    expect(await getCurrentUser()).toBeNull();
    expect(meCalls).toBe(2);
    expect(refreshCalls).toBe(1);
  });

  it("stops after a failed refresh without retrying the profile request", async () => {
    let meCalls = 0;
    let refreshCalls = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url.endsWith("/users/me")) {
          meCalls++;
          return new Response(null, { status: 401 });
        }
        refreshCalls++;
        return new Response(null, { status: 401 });
      }),
    );
    expect(await getCurrentUser()).toBeNull();
    expect(meCalls).toBe(1);
    expect(refreshCalls).toBe(1);
  });

  it("uses only the trusted web cookie session for explicit extension approval and revocation", async () => {
    const id = "11111111-1111-4111-8111-111111111111";
    const fetcher = vi.fn(async (url: string, _options: RequestInit) =>
      url.endsWith(`/${id}`)
        ? Response.json({
            requestId: id,
            pairingCode: "111111",
            expiresAt: "2026-10-01T00:00:00.000Z",
            approved: false,
          })
        : new Response(null, { status: 204 }),
    );
    vi.stubGlobal("fetch", fetcher);
    expect((await getExtensionLinkRequest(id)).pairingCode).toBe("111111");
    await approveExtensionLinkRequest(id);
    await revokeExtensionAuthorization(id);
    expect(fetcher).toHaveBeenCalledTimes(3);
    for (const [, options] of fetcher.mock.calls) {
      expect(options.credentials).toBe("include");
      expect(options.headers ?? {}).not.toHaveProperty("Authorization");
    }
    expect(fetcher.mock.calls[1]?.[0]).toBe(
      `http://localhost:3001/api/v1/extension/link-requests/${id}/approve`,
    );
  });

  it("loads and removes watches with the web cookie, retrying once after refresh", async () => {
    let listCalls = 0;
    const fetcher = vi.fn(async (url: string, options: RequestInit) => {
      expect(options.credentials).toBe("include");
      expect(options.headers ?? {}).not.toHaveProperty("Authorization");
      if (url.endsWith("/auth/refresh"))
        return new Response(null, { status: 204 });
      if (url.endsWith("/watches") && options.method === "GET") {
        listCalls++;
        return listCalls === 1
          ? new Response(null, { status: 401 })
          : Response.json([{ id: "watch-1", status: "FULL" }]);
      }
      if (url.endsWith("/watches/watch-1") && options.method === "DELETE")
        return new Response(null, { status: 204 });
      throw new Error("Unexpected request");
    });
    vi.stubGlobal("fetch", fetcher);
    expect(await listWatches()).toEqual([{ id: "watch-1", status: "FULL" }]);
    await removeWatch("watch-1");
    expect(fetcher.mock.calls.map(([url]) => url)).toEqual([
      "http://localhost:3001/api/v1/watches",
      "http://localhost:3001/api/v1/auth/refresh",
      "http://localhost:3001/api/v1/watches",
      "http://localhost:3001/api/v1/watches/watch-1",
    ]);
  });
});
