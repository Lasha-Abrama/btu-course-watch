import { describe, expect, it, vi } from "vitest";
import type { CourseObservation } from "@btu-course-watch/contracts";
import { completeInspection } from "./inspection-submission.js";

const observation: CourseObservation = {
  btuCourseId: "665",
  observedAt: "2026-09-29T10:00:00.000Z",
  courseName: null,
  groups: [],
};

describe("inspection to watch ordering", () => {
  it("submits structured observation before loading server watch state", async () => {
    const order: string[] = [];
    const result = await completeInspection(
      { ok: true, observation },
      async (value) => {
        expect(value).toBe(observation);
        order.push("submit");
        return { state: "SUBMITTED" };
      },
      async () => {
        order.push("list");
        return { state: "READY", watches: [] };
      },
    );
    expect(order).toEqual(["submit", "list"]);
    expect(result).toMatchObject({ ok: true, watches: { state: "READY" } });
  });

  it("preserves local observation and never loads watches after submission failure", async () => {
    const list = vi.fn();
    const result = await completeInspection(
      { ok: true, observation },
      async () => ({ state: "SUBMISSION_FAILED" }),
      list,
    );
    expect(result).toMatchObject({
      ok: true,
      observation,
      watches: { state: "REQUEST_FAILED" },
    });
    expect(list).not.toHaveBeenCalled();
  });

  it("does not misreport a successful submission when watch-state loading fails", async () => {
    const result = await completeInspection(
      { ok: true, observation },
      async () => ({ state: "SUBMITTED" }),
      async () => {
        throw new Error("network failure");
      },
    );
    expect(result).toMatchObject({
      ok: true,
      submission: { state: "SUBMITTED" },
      watches: { state: "REQUEST_FAILED" },
    });
  });
});
