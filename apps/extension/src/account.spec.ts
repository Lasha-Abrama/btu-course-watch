import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CourseObservation } from "@btu-course-watch/contracts";
import {
  linkStatus,
  listWatches,
  startLink,
  submitObservation,
  unwatchGroup,
  watchGroup,
} from "./account.js";

const EXTENSION_ID = "a".repeat(32);
const observation: CourseObservation = {
  btuCourseId: "665",
  observedAt: "2026-09-29T10:00:00.000Z",
  courseName: null,
  groups: [
    {
      btuGroupId: "13575",
      name: "ჯგუფი 1.1",
      capacity: 27,
      status: "FULL",
      chooseUrl: null,
    },
  ],
};

function storage() {
  const values: Record<string, unknown> = {};
  return {
    values,
    get: vi.fn(async (key: string) => ({ [key]: values[key] })),
    set: vi.fn(async (items: Record<string, unknown>) => {
      Object.assign(values, items);
    }),
    remove: vi.fn(async (key: string) => {
      delete values[key];
    }),
  };
}

beforeEach(() => {
  vi.stubGlobal("chrome", { runtime: { id: EXTENSION_ID } });
});

describe("extension Course Watch authorization", () => {
  it("starts a challenge-bound link without web cookies or URL credentials", async () => {
    const local = storage();
    const fetcher = vi.fn(async () =>
      Response.json({
        requestId: "11111111-1111-4111-8111-111111111111",
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
      }),
    );
    const result = await startLink(local, fetcher as typeof fetch);
    const [url, options] = fetcher.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(url).toBe("http://localhost:3001/api/v1/extension/link-requests");
    expect(options.credentials).toBe("omit");
    expect(options.headers).not.toHaveProperty("Authorization");
    expect(JSON.parse(options.body as string)).toMatchObject({
      challengeHash: expect.stringMatching(/^[0-9a-f]{64}$/),
    });
    expect(result.url).toBe(
      "http://localhost:3000/extension-link?requestId=11111111-1111-4111-8111-111111111111",
    );
    expect(result.url).not.toContain(
      (local.values.courseWatchLink as { pending: { verifier: string } })
        .pending.verifier,
    );
    expect(local.values.courseWatchLink).not.toHaveProperty("credential");
  });

  it("exchanges once, stores only the Course Watch credential, and submits only observation JSON", async () => {
    const local = storage();
    const requestId = "11111111-1111-4111-8111-111111111111";
    const expiry = new Date(Date.now() + 60_000).toISOString();
    const credential = `bcwx_${"B".repeat(43)}`;
    const startFetch = vi.fn(async () =>
      Response.json({ requestId, expiresAt: expiry }),
    );
    await startLink(local, startFetch as typeof fetch);
    const exchangeFetch = vi.fn(async () =>
      Response.json({ credential, expiresAt: expiry }),
    );
    expect(await linkStatus(local, exchangeFetch as typeof fetch)).toEqual({
      state: "LINKED",
      expiresAt: expiry,
    });
    expect(local.values.courseWatchLink).not.toHaveProperty("pending");
    const submitFetch = vi.fn(async () =>
      Response.json({ btuCourseId: "665" }, { status: 201 }),
    );
    expect(
      await submitObservation(observation, local, submitFetch as typeof fetch),
    ).toEqual({ state: "SUBMITTED" });
    const [url, options] = submitFetch.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(url).toBe("http://localhost:3001/api/v1/extension/observations");
    expect(options.credentials).toBe("omit");
    expect(options.headers).toMatchObject({
      Authorization: `Bearer ${credential}`,
      "X-BCW-Extension-Id": EXTENSION_ID,
    });
    expect(JSON.parse(options.body as string)).toEqual(observation);
    expect(JSON.stringify(observation)).not.toMatch(/cookie|password|rawHtml/i);
  });

  it("drops revoked credentials and preserves local inspection on submission failures", async () => {
    const local = storage();
    local.values.monitoringHealth = {
      state: "CHECKED",
      failures: [{ btuCourseId: "665" }],
    };
    local.values.monitoringCursor = 2;
    local.values.courseWatchLink = {
      credential: {
        value: `bcwx_${"B".repeat(43)}`,
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
      },
    };
    const failure = vi.fn(async () => new Response(null, { status: 503 }));
    expect(
      await submitObservation(observation, local, failure as typeof fetch),
    ).toEqual({ state: "SUBMISSION_FAILED" });
    expect(local.values.courseWatchLink).toBeDefined();
    const revoked = vi.fn(async () => new Response(null, { status: 401 }));
    expect(
      await submitObservation(observation, local, revoked as typeof fetch),
    ).toEqual({ state: "AUTH_REQUIRED" });
    expect(local.values.courseWatchLink).toBeUndefined();
    expect(local.values.monitoringHealth).toBeUndefined();
    expect(local.values.monitoringCursor).toBeUndefined();
    expect(
      await submitObservation(observation, local, revoked as typeof fetch),
    ).toEqual({ state: "NOT_LINKED" });
  });

  it("loads server watch state only after authorized requests and refetches after mutation", async () => {
    const local = storage();
    const credential = `bcwx_${"B".repeat(43)}`;
    local.values.courseWatchLink = {
      credential: {
        value: credential,
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
      },
    };
    const watch = {
      id: "11111111-1111-4111-8111-111111111111",
      btuCourseId: "665",
      btuGroupId: "13575",
      status: "FULL",
    };
    const fetcher = vi.fn(async (_url: string, options: RequestInit) =>
      options.method === "GET" || !options.method
        ? Response.json([watch])
        : new Response(null, { status: 204 }),
    );
    expect(await listWatches(local, fetcher as typeof fetch)).toEqual({
      state: "READY",
      watches: [watch],
    });
    expect(
      await watchGroup(
        { btuCourseId: "665", btuGroupId: "13575" },
        local,
        fetcher as typeof fetch,
      ),
    ).toEqual({ state: "READY", watches: [watch] });
    expect(
      await unwatchGroup(watch.id, local, fetcher as typeof fetch),
    ).toEqual({ state: "READY", watches: [watch] });
    expect(
      fetcher.mock.calls.map(([, options]) => options.method ?? "GET"),
    ).toEqual(["GET", "PUT", "GET", "DELETE", "GET"]);
    const [, putOptions] = fetcher.mock.calls[1] as [string, RequestInit];
    expect(putOptions.credentials).toBe("omit");
    expect(putOptions.headers).toMatchObject({
      Authorization: `Bearer ${credential}`,
    });
    expect(JSON.parse(putOptions.body as string)).toEqual({
      btuCourseId: "665",
      btuGroupId: "13575",
    });
    for (const [url, options] of fetcher.mock.calls) {
      expect(url).not.toContain(credential);
      expect(options.credentials).toBe("omit");
    }
  });

  it("does not invent local watch state; revocation clears authorization and failures preserve it", async () => {
    const local = storage();
    expect(await listWatches(local, vi.fn() as typeof fetch)).toEqual({
      state: "NOT_LINKED",
    });
    local.values.courseWatchLink = {
      credential: {
        value: `bcwx_${"B".repeat(43)}`,
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
      },
    };
    expect(
      await listWatches(
        local,
        vi.fn(async () => new Response(null, { status: 503 })) as typeof fetch,
      ),
    ).toEqual({ state: "REQUEST_FAILED" });
    expect(local.values.courseWatchLink).toBeDefined();
    expect(
      await watchGroup(
        { btuCourseId: "665", btuGroupId: "13575" },
        local,
        vi.fn(async () => new Response(null, { status: 401 })) as typeof fetch,
      ),
    ).toEqual({ state: "AUTH_REQUIRED" });
    expect(local.values.courseWatchLink).toBeUndefined();
  });
});
