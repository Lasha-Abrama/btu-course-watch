import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  assertCourseObservation,
  isBtuChooseUrl,
  type CourseObservation,
} from "@btu-course-watch/contracts";
import { parseCoursePage } from "../src/index.js";

const context = {
  btuCourseId: " COURSE-101 ",
  observedAt: "2026-09-29T08:00:00.000Z",
  courseName: " Synthetic course ",
};

function fixture(name: string): string {
  return readFileSync(
    new URL(`./fixtures/${name}.html`, import.meta.url),
    "utf8",
  );
}

function scan(name: string): CourseObservation {
  return parseCoursePage(fixture(name), context);
}

describe("BTU Classroom course page parser", () => {
  it("preserves each external group ID, name and capacity without deriving choose URLs", () => {
    const observation = scan("mixed-groups");
    expect(observation).toEqual({
      btuCourseId: "COURSE-101",
      observedAt: context.observedAt,
      courseName: "Synthetic course",
      groups: [
        {
          btuGroupId: "13299",
          name: "ჯგუფი 1.1",
          capacity: 27,
          status: "FULL",
          chooseUrl: null,
        },
        {
          btuGroupId: "13435",
          name: "ჯგუფი 1.2",
          capacity: 25,
          status: "AVAILABLE",
          chooseUrl: "https://classroom.btu.edu.ge/ge/student/me/choose/90002",
        },
      ],
    });
    expect(observation.groups[1]!.chooseUrl).not.toContain(
      observation.groups[1]!.btuGroupId,
    );
    expect(() =>
      assertCourseObservation(JSON.parse(JSON.stringify(observation))),
    ).not.toThrow();
  });

  it("keeps full group IDs discoverable when every disabled control lacks data-href", () => {
    const observation = scan("all-full");
    expect(observation.groups.map((group) => group.btuGroupId)).toEqual([
      "13299",
      "13435",
    ]);
    expect(
      observation.groups.every(
        (group) => group.status === "FULL" && group.chooseUrl === null,
      ),
    ).toBe(true);
  });

  it("recognizes the same group ID becoming available only from the new exposed URL", () => {
    const before = scan("all-full").groups.find(
      (group) => group.btuGroupId === "13435",
    );
    const after = scan("mixed-groups").groups.find(
      (group) => group.btuGroupId === "13435",
    );
    expect(before).toMatchObject({ status: "FULL", chooseUrl: null });
    expect(after).toMatchObject({
      status: "AVAILABLE",
      chooseUrl: "https://classroom.btu.edu.ge/ge/student/me/choose/90002",
    });
  });

  it("does not assign nearby or detail-row actions to malformed groups", () => {
    const observation = scan("partial-groups");
    expect(observation.groups.map((group) => group.btuGroupId)).toEqual([
      "13299",
      "13435",
      "13500",
      "13600",
    ]);
    expect(
      observation.groups.every(
        (group) => group.status === "UNKNOWN" && group.chooseUrl === null,
      ),
    ).toBe(true);
    expect(observation.groups[0]!.name).toBe("ჯგუფი 1.1");
    expect(observation.groups[3]!.capacity).toBe(20);
  });

  it("normalizes Georgian whitespace and preserves an unrecognized capacity suffix as text", () => {
    const observation = scan("whitespace-georgian");
    expect(observation.groups[0]).toEqual({
      btuGroupId: "13700",
      name: "ჯგუფი 3.1",
      capacity: 0,
      status: "AVAILABLE",
      chooseUrl: "https://classroom.btu.edu.ge/ge/student/me/choose/90100",
    });
    expect(observation.groups[1]).toEqual({
      btuGroupId: "13800",
      name: "ჯგუფი 3.2 - (უცნობი)",
      capacity: null,
      status: "FULL",
      chooseUrl: null,
    });
  });

  it("ignores unrelated controls and makes multiple candidate actions UNKNOWN", () => {
    const observation = scan("unrelated-actions");
    expect(observation.groups.map((group) => group.status)).toEqual([
      "UNKNOWN",
      "UNKNOWN",
      "UNKNOWN",
    ]);
    expect(observation.groups.every((group) => group.chooseUrl === null)).toBe(
      true,
    );
  });

  it("rejects malformed or non-BTU choose URLs without constructing substitutes", () => {
    const observation = scan("invalid-urls");
    expect(observation.groups).toHaveLength(7);
    expect(
      observation.groups.every(
        (group) => group.status === "UNKNOWN" && group.chooseUrl === null,
      ),
    ).toBe(true);
    expect(
      isBtuChooseUrl("https://classroom.btu.edu.ge/ge/student/me/choose/123"),
    ).toBe(true);
    expect(
      isBtuChooseUrl(
        "https://classroom.btu.edu.ge@evil.example/ge/student/me/choose/123",
      ),
    ).toBe(false);
    expect(
      isBtuChooseUrl(
        "https://classroom.btu.edu.ge:444/ge/student/me/choose/123",
      ),
    ).toBe(false);
    expect(
      isBtuChooseUrl(
        "https://classroom.btu.edu.ge/ge/student/me/choose/1/../123",
      ),
    ).toBe(false);
  });

  it("allows later N→N+1 comparison by external ID without implementing a watcher", () => {
    const earlier = new Set(
      scan("mixed-groups").groups.map((group) => group.btuGroupId),
    );
    const later = new Set(
      scan("new-group").groups.map((group) => group.btuGroupId),
    );
    expect([...later].filter((id) => !earlier.has(id))).toEqual(["14900"]);
  });

  it("is deterministic for identical input and stable across row order", () => {
    const html = fixture("mixed-groups");
    expect(parseCoursePage(html, context)).toEqual(
      parseCoursePage(html, context),
    );
    expect(scan("mixed-groups-reordered")).toEqual(
      parseCoursePage(html, context),
    );
  });

  it("fails explicitly for missing or duplicate group keys instead of misattributing another group", () => {
    expect(() =>
      parseCoursePage(
        '<table><tr><td><a class="group_title">ჯგუფი 1</a></td></tr></table>',
        context,
      ),
    ).toThrow("missing data-id");
    expect(() =>
      parseCoursePage(
        '<table><tr><td><a class="group_title" data-id="1">ჯგუფი 1</a></td></tr><tr><td><a class="group_title" data-id="1">ჯგუფი 2</a></td></tr></table>',
        context,
      ),
    ).toThrow("Duplicate btuGroupId");
  });

  it("does not mark an aria-disabled or disabled-class Choose control available", () => {
    const html =
      '<table><tr><td><a class="group_title" data-id="1">ჯგუფი 1 - (20)</a></td><td><a class="btn btn-primary chooseGroup disabled" data-type="choose" data-href="https://classroom.btu.edu.ge/ge/student/me/choose/50">არჩევა</a></td></tr><tr><td><a class="group_title" data-id="2">ჯგუფი 2 - (20)</a></td><td><a class="btn btn-primary chooseGroup" aria-disabled="true" data-type="choose" data-href="https://classroom.btu.edu.ge/ge/student/me/choose/51">არჩევა</a></td></tr></table>';
    expect(
      parseCoursePage(html, context).groups.map((group) => group.status),
    ).toEqual(["UNKNOWN", "UNKNOWN"]);
  });

  it("keeps an ambiguous group isolated from an unambiguous neighboring group", () => {
    const html =
      '<table><tr><td><a class="group_title" data-id="1">ჯგუფი 1 - (20)</a></td><td><a class="btn btn-primary chooseGroup" data-type="choose" data-href="https://classroom.btu.edu.ge/ge/student/me/choose/50"></a><a class="btn btn-default chooseGroup" disabled></a></td></tr><tr><td><a class="group_title" data-id="2">ჯგუფი 2 - (20)</a></td><td><a class="btn btn-default chooseGroup" disabled></a></td></tr></table>';
    expect(parseCoursePage(html, context).groups).toMatchObject([
      { btuGroupId: "1", status: "UNKNOWN", chooseUrl: null },
      { btuGroupId: "2", status: "FULL", chooseUrl: null },
    ]);
  });

  it("requires explicit valid course context and validates observation invariants", () => {
    expect(() =>
      parseCoursePage("<table></table>", { ...context, btuCourseId: "   " }),
    ).toThrow("Invalid btuCourseId");
    expect(() =>
      parseCoursePage("<table></table>", {
        ...context,
        observedAt: "not-a-date",
      }),
    ).toThrow("Invalid observedAt");
    const invalid = scan("mixed-groups");
    invalid.groups[0]!.capacity = -1;
    expect(() => assertCourseObservation(invalid)).toThrow(
      "Invalid group capacity",
    );
    invalid.groups[0]!.capacity = 27;
    invalid.groups[0]!.chooseUrl =
      "https://classroom.btu.edu.ge/ge/student/me/choose/1";
    expect(() => assertCourseObservation(invalid)).toThrow(
      "Non-available group cannot expose",
    );
  });
});
