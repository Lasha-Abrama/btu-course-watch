import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import type {
  CourseObservation,
  WatchResponse,
} from "@btu-course-watch/contracts";
import {
  ensureMonitoringAlarm,
  inspectWatchedCourse,
  MAX_COURSES_PER_CYCLE,
  MONITOR_ALARM,
  MONITOR_INTERVAL_MINUTES,
  readMonitoringHealth,
  runMonitoringCycle,
} from "./monitoring.js";

const origin = "https://classroom.btu.edu.ge";
const subject = (id: string) => `${origin}/ge/student/me/course/index/${id}`;
const groups = (id: string) => `${origin}/ge/student/me/course/groups/${id}/47`;
const fixture = (name: string) =>
  readFileSync(
    new URL(
      `../../../packages/classroom-parser/test/fixtures/${name}.html`,
      import.meta.url,
    ),
    "utf8",
  );
const time = new Date("2026-09-30T12:00:00.000Z");

function response(body: string, status = 200, url = ""): Response {
  const result = new Response(body, { status });
  Object.defineProperty(result, "url", { value: url });
  return result;
}

function storage() {
  const values: Record<string, unknown> = {};
  return {
    values,
    get: vi.fn(async (key: string) => ({ [key]: values[key] })),
    set: vi.fn(async (items: Record<string, unknown>) => {
      Object.assign(values, items);
    }),
  };
}

function watch(courseId: string, groupId = "13299"): WatchResponse {
  return {
    id: crypto.randomUUID(),
    createdAt: time.toISOString(),
    btuCourseId: courseId,
    courseName: null,
    btuGroupId: groupId,
    groupName: null,
    capacity: 27,
    status: "FULL",
    lastObservedAt: time.toISOString(),
  };
}

function observation(
  courseId: string,
  groupIds = ["13299"],
): CourseObservation {
  return {
    btuCourseId: courseId,
    observedAt: time.toISOString(),
    courseName: null,
    groups: groupIds.map((btuGroupId) => ({
      btuGroupId,
      name: "ჯგუფი 1.1",
      capacity: 27,
      status: "FULL" as const,
      chooseUrl: null,
    })),
  };
}

describe("one MV3 monitoring alarm", () => {
  it("creates a jittered 30-minute alarm once and reconciles changed cadence", async () => {
    let alarm: { periodInMinutes: number } | undefined;
    const alarms = {
      get: vi.fn(async () => alarm),
      create: vi.fn(
        async (_name: string, info: chrome.alarms.AlarmCreateInfo) => {
          alarm = { periodInMinutes: info.periodInMinutes! };
        },
      ),
    };
    await ensureMonitoringAlarm(alarms as never, () => 0.5);
    await ensureMonitoringAlarm(alarms as never, () => 0.9);
    expect(alarms.create).toHaveBeenCalledTimes(1);
    expect(alarms.create).toHaveBeenCalledWith(MONITOR_ALARM, {
      delayInMinutes: 32.5,
      periodInMinutes: MONITOR_INTERVAL_MINUTES,
    });
    alarm = { periodInMinutes: 1 };
    await ensureMonitoringAlarm(alarms as never, () => 0);
    expect(alarms.create).toHaveBeenCalledTimes(2);
  });
});

describe("authenticated browser-local course inspection", () => {
  it.each(["665", "672"])(
    "fetches subject %s, follows only its exposed Groups href, and returns structured data",
    async (id) => {
      const fetchPage = vi.fn(async (url: string) =>
        response(
          url === subject(id)
            ? fixture(`subject-${id}`)
            : fixture("mixed-groups"),
          200,
          url,
        ),
      );
      const result = await inspectWatchedCourse(id, fetchPage);
      expect(fetchPage.mock.calls.map(([url]) => url)).toEqual([
        subject(id),
        groups(id),
      ]);
      for (const [, options] of fetchPage.mock.calls as unknown as Array<
        [string, RequestInit]
      >) {
        expect(options).toMatchObject({
          credentials: "include",
          cache: "no-store",
          redirect: "manual",
        });
        expect(options).not.toHaveProperty("headers");
        expect(options.signal).toBeDefined();
      }
      expect(result).toMatchObject({
        ok: true,
        observation: {
          btuCourseId: id,
          groups: [
            { btuGroupId: "13299", status: "FULL" },
            { btuGroupId: "13435", status: "AVAILABLE" },
          ],
        },
      });
      expect(JSON.stringify(result)).not.toContain("<html");
      expect(JSON.stringify(result)).not.toContain("/course/groups/");
    },
  );

  it.each([302, 401, 403])(
    "does not fetch Groups after a subject authentication response %i",
    async (status) => {
      const fetchPage = vi.fn(async () => response("", status));
      expect(await inspectWatchedCourse("665", fetchPage)).toEqual({
        ok: false,
        reason: "BTU_SESSION_REQUIRED",
      });
      expect(fetchPage).toHaveBeenCalledTimes(1);
    },
  );

  it("rejects changed destinations and login HTML", async () => {
    expect(
      await inspectWatchedCourse(
        "665",
        vi.fn(async () => response("", 200, `${origin}/ge/login`)),
      ),
    ).toEqual({ ok: false, reason: "BTU_SESSION_REQUIRED" });
    expect(
      await inspectWatchedCourse(
        "665",
        vi.fn(async () => response('<input type="password" value="SECRET">')),
      ),
    ).toEqual({ ok: false, reason: "BTU_SESSION_REQUIRED" });
  });

  it("treats an unavailable subject route as discovery failure", async () => {
    expect(
      await inspectWatchedCourse(
        "665",
        vi.fn(async () => response("", 404)),
      ),
    ).toEqual({ ok: false, reason: "ROUTE_DISCOVERY_UNAVAILABLE" });
  });

  it("distinguishes absent routes, failed requests, and malformed Groups markup without inventing UNKNOWN", async () => {
    const missing = vi.fn(async () => response("<main>No Groups link</main>"));
    expect(await inspectWatchedCourse("665", missing)).toEqual({
      ok: false,
      reason: "ROUTE_DISCOVERY_UNAVAILABLE",
    });
    expect(missing).toHaveBeenCalledTimes(1);
    expect(
      await inspectWatchedCourse(
        "665",
        vi.fn(async () => {
          throw new Error("SECRET_TOKEN");
        }),
      ),
    ).toEqual({ ok: false, reason: "CLASSROOM_REQUEST_FAILED" });
    const malformed = vi.fn(async (url: string) =>
      response(
        url === subject("665")
          ? fixture("subject-665")
          : '<a class="group_title">SECRET_TOKEN</a>',
      ),
    );
    expect(await inspectWatchedCourse("665", malformed)).toEqual({
      ok: false,
      reason: "PARSER_FAILED",
    });
    expect(malformed).toHaveBeenCalledTimes(2);
    expect(await inspectWatchedCourse("../evil", vi.fn())).toEqual({
      ok: false,
      reason: "ROUTE_DISCOVERY_UNAVAILABLE",
    });
  });

  it("treats a Groups request failure as a failure, not an UNKNOWN observation", async () => {
    const failedGroups = vi.fn(async (url: string) => {
      if (url === subject("665")) return response(fixture("subject-665"));
      throw new Error("SECRET_TOKEN");
    });
    expect(await inspectWatchedCourse("665", failedGroups)).toEqual({
      ok: false,
      reason: "CLASSROOM_REQUEST_FAILED",
    });
    expect(failedGroups).toHaveBeenCalledTimes(2);
  });

  it("leaves selection-disabled classification to the shared parser", async () => {
    const fetchPage = vi.fn(async (url: string) =>
      response(
        url === subject("665")
          ? fixture("subject-665")
          : fixture("selection-disabled"),
      ),
    );
    const result = await inspectWatchedCourse("665", fetchPage);
    expect(result).toMatchObject({
      ok: true,
      observation: {
        groups: [
          { btuGroupId: "20001", status: "UNKNOWN", chooseUrl: null },
          { btuGroupId: "20002", status: "FULL", chooseUrl: null },
        ],
      },
    });
  });
});

describe("bounded scheduled cycle and local health", () => {
  it("does no Classroom fetch with zero watches, a missing link, or revoked authorization", async () => {
    const local = storage();
    const inspect = vi.fn();
    const submit = vi.fn();
    const base = { storage: local, inspect, submit, now: () => time };
    expect(
      (
        await runMonitoringCycle({
          ...base,
          list: async () => ({ state: "NOT_LINKED" }),
        })
      ).state,
    ).toBe("LINK_REQUIRED");
    expect(
      (
        await runMonitoringCycle({
          ...base,
          list: async () => ({ state: "AUTH_REQUIRED" }),
        })
      ).state,
    ).toBe("LINK_REQUIRED");
    expect(
      (
        await runMonitoringCycle({
          ...base,
          list: async () => ({ state: "READY", watches: [] }),
        })
      ).state,
    ).toBe("NO_WATCHES");
    expect(
      (
        await runMonitoringCycle({
          ...base,
          list: async () => ({ state: "REQUEST_FAILED" }),
        })
      ).state,
    ).toBe("COURSE_WATCH_UNAVAILABLE");
    expect(inspect).not.toHaveBeenCalled();
    expect(submit).not.toHaveBeenCalled();
    expect((await readMonitoringHealth(local)).lastAttemptAt).toBeNull();
  });

  it("deduplicates watched groups by course and submits each structured observation once", async () => {
    const local = storage();
    const inspect = vi.fn(async (id: string) => ({
      ok: true as const,
      observation: observation(id, ["13299", "13435"]),
    }));
    const submit = vi.fn(async () => ({ state: "SUBMITTED" as const }));
    const health = await runMonitoringCycle({
      storage: local,
      now: () => time,
      list: async () => ({
        state: "READY",
        watches: [watch("665"), watch("665", "13435"), watch("672")],
      }),
      inspect,
      submit,
    });
    expect(inspect.mock.calls.map(([id]) => id)).toEqual(["665", "672"]);
    expect(submit).toHaveBeenCalledTimes(2);
    expect(health).toMatchObject({
      state: "CHECKED",
      watchedCourseCount: 2,
      attemptedCourseCount: 2,
      submittedCourseCount: 2,
      lastAttemptAt: time.toISOString(),
      lastSuccessfulObservationAt: time.toISOString(),
      failures: [],
    });
    expect(JSON.stringify(local.values.monitoringHealth)).not.toMatch(
      /\/course\/groups\/|<html|cookie|47/i,
    );
  });

  it("bounds a cycle and rotates across more courses after worker restart", async () => {
    const local = storage();
    const inspect = vi.fn(async (id: string) => ({
      ok: true as const,
      observation: observation(id),
    }));
    const watches = ["1", "2", "3", "4", "5"].map((id) => watch(id));
    const deps = {
      storage: local,
      now: () => time,
      list: async () => ({ state: "READY" as const, watches }),
      inspect,
      submit: async () => ({ state: "SUBMITTED" as const }),
    };
    await runMonitoringCycle(deps);
    expect(inspect.mock.calls.map(([id]) => id)).toEqual(["1", "2", "3", "4"]);
    inspect.mockClear();
    await runMonitoringCycle(deps);
    expect(inspect.mock.calls.map(([id]) => id)).toEqual(["5", "1", "2", "3"]);
    expect(MAX_COURSES_PER_CYCLE).toBe(4);
  });

  it("records partial failure without losing successful time or inferring a missing watched group state", async () => {
    const local = storage();
    const submit = vi.fn(async () => ({ state: "SUBMITTED" as const }));
    const health = await runMonitoringCycle({
      storage: local,
      now: () => time,
      list: async () => ({
        state: "READY",
        watches: [watch("665", "absent"), watch("672")],
      }),
      inspect: async (id) =>
        id === "665"
          ? { ok: true, observation: observation(id) }
          : { ok: false, reason: "ROUTE_DISCOVERY_UNAVAILABLE" },
      submit,
    });
    expect(submit).toHaveBeenCalledTimes(1);
    expect(health.state).toBe("PARTIAL_FAILURE");
    expect(health.lastSuccessfulObservationAt).toBe(time.toISOString());
    expect(health.failures).toEqual([
      { btuCourseId: "665", reason: "WATCHED_GROUP_MISSING" },
      { btuCourseId: "672", reason: "ROUTE_DISCOVERY_UNAVAILABLE" },
    ]);
    const later = new Date(time.getTime() + 30 * 60_000);
    const failed = await runMonitoringCycle({
      storage: local,
      now: () => later,
      list: async () => ({ state: "READY", watches: [watch("665")] }),
      inspect: async () => ({ ok: false, reason: "PARSER_FAILED" }),
      submit,
    });
    expect(failed.lastAttemptAt).toBe(later.toISOString());
    expect(failed.lastSuccessfulObservationAt).toBe(time.toISOString());
    expect(submit).toHaveBeenCalledTimes(1);
  });

  it("pauses BTU traffic after session expiry and stops immediately when submission auth is revoked", async () => {
    const local = storage();
    const inspect = vi.fn(async () => ({
      ok: false as const,
      reason: "BTU_SESSION_REQUIRED" as const,
    }));
    const watches = [watch("665"), watch("672")];
    const deps = {
      storage: local,
      now: () => time,
      list: async () => ({ state: "READY" as const, watches }),
      inspect,
      submit: vi.fn(),
    };
    const first = await runMonitoringCycle(deps);
    expect(inspect).toHaveBeenCalledTimes(1);
    expect(first.nextBtuRetryAt).toBe(
      new Date(time.getTime() + 2 * 60 * 60_000).toISOString(),
    );
    await runMonitoringCycle(deps);
    expect(inspect).toHaveBeenCalledTimes(1);
    const revokedInspect = vi.fn(async (id: string) => ({
      ok: true as const,
      observation: observation(id),
    }));
    const revoked = await runMonitoringCycle({
      storage: storage(),
      now: () => time,
      list: async () => ({ state: "READY", watches }),
      inspect: revokedInspect,
      submit: async () => ({ state: "AUTH_REQUIRED" }),
    });
    expect(revoked.state).toBe("LINK_REQUIRED");
    expect(revokedInspect).toHaveBeenCalledTimes(1);
    expect(revoked.lastSuccessfulObservationAt).toBeNull();
  });

  it("does not count a failed Course Watch submission as a successful observation", async () => {
    const local = storage();
    const result = await runMonitoringCycle({
      storage: local,
      now: () => time,
      list: async () => ({ state: "READY", watches: [watch("665")] }),
      inspect: async () => ({ ok: true, observation: observation("665") }),
      submit: async () => ({ state: "SUBMISSION_FAILED" }),
    });
    expect(result).toMatchObject({
      state: "FAILED",
      submittedCourseCount: 0,
      lastSuccessfulObservationAt: null,
      failures: [{ btuCourseId: "665", reason: "SUBMISSION_FAILED" }],
    });
  });
});
