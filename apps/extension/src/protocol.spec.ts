import { describe, expect, it } from "vitest";
import type { WatchResponse } from "@btu-course-watch/contracts";
import { isPopupRequest, watchForGroup } from "./protocol.js";

describe("watch popup boundary", () => {
  it("accepts only narrowly shaped watch messages", () => {
    expect(
      isPopupRequest({
        type: "WATCH_GROUP",
        group: { btuCourseId: "665", btuGroupId: "13344" },
      }),
    ).toBe(true);
    expect(
      isPopupRequest({
        type: "WATCH_GROUP",
        group: { btuCourseId: "665", btuGroupId: "13344", userId: "forged" },
      }),
    ).toBe(false);
    expect(
      isPopupRequest({
        type: "WATCH_GROUP",
        group: { btuCourseId: "../evil", btuGroupId: "13344" },
      }),
    ).toBe(false);
    expect(
      isPopupRequest({
        type: "UNWATCH_GROUP",
        watchId: "11111111-1111-4111-8111-111111111111",
      }),
    ).toBe(true);
    expect(isPopupRequest({ type: "UNWATCH_GROUP", watchId: "../evil" })).toBe(
      false,
    );
  });

  it("matches server-owned watch state by course and group, not availability or group ID alone", () => {
    const watch = {
      id: "11111111-1111-4111-8111-111111111111",
      btuCourseId: "665",
      btuGroupId: "13344",
    } as WatchResponse;
    expect(watchForGroup([watch], "665", "13344")).toBe(watch);
    expect(watchForGroup([watch], "672", "13344")).toBeUndefined();
  });
});
