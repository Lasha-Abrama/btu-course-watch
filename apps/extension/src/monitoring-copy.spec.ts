import { describe, expect, it } from "vitest";
import type { MonitoringHealth } from "./monitoring.js";
import { monitoringCopy } from "./monitoring-copy.js";

const base: MonitoringHealth = {
  state: "WAITING",
  lastAttemptAt: null,
  lastSuccessfulObservationAt: null,
  watchedCourseCount: 0,
  attemptedCourseCount: 0,
  submittedCourseCount: 0,
  failures: [],
  nextBtuRetryAt: null,
};

describe("monitoring popup copy", () => {
  it("separates watch intent, automatic checks, and last-known availability", () => {
    expect(monitoringCopy(base)).toContain(
      "waiting for the next scheduled run",
    );
    expect(monitoringCopy({ ...base, state: "NO_WATCHES" })).toContain(
      "No watched courses",
    );
    expect(monitoringCopy({ ...base, state: "LINK_REQUIRED" })).toContain(
      "Connect Course Watch",
    );
    expect(
      monitoringCopy({ ...base, state: "COURSE_WATCH_UNAVAILABLE" }),
    ).toContain("Could not load");
    expect(
      monitoringCopy({
        ...base,
        state: "CHECKED",
        attemptedCourseCount: 2,
        submittedCourseCount: 2,
      }),
    ).toContain("2 of 2 course checks submitted");
  });

  it("names a partial failure and recovery without exposing HTML or URLs", () => {
    const copy = monitoringCopy({
      ...base,
      state: "PARTIAL_FAILURE",
      attemptedCourseCount: 2,
      submittedCourseCount: 1,
      failures: [
        { btuCourseId: "665", reason: "BTU_SESSION_REQUIRED" },
        { btuCourseId: "672", reason: "ROUTE_DISCOVERY_UNAVAILABLE" },
      ],
    });
    expect(copy).toContain("1 of 2 course checks submitted");
    expect(copy).toContain("Sign in to BTU Classroom");
    expect(copy).toContain("Groups link could not be confirmed");
    expect(copy).not.toMatch(/cookie|password|<html|\/course\/groups\//i);
  });
});
