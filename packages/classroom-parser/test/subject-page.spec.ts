import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { discoverGroupsUrl } from "../src/index.js";

const origin = "https://classroom.btu.edu.ge";
const subject = (id: string) => `${origin}/ge/student/me/course/index/${id}`;
const groups = (id: string, opaque = "47") =>
  `${origin}/ge/student/me/course/groups/${id}/${opaque}`;
const fixture = (name: string) =>
  readFileSync(new URL(`./fixtures/${name}.html`, import.meta.url), "utf8");
const link = (href: string) => `<a href="${href}">Groups</a>`;

describe("fetched subject-page Groups link discovery", () => {
  it("extracts the two sanitized observed course routes without deriving the opaque segment", () => {
    expect(
      discoverGroupsUrl(fixture("subject-665"), subject("665"), "665"),
    ).toBe(groups("665"));
    expect(
      discoverGroupsUrl(fixture("subject-672"), subject("672"), "672"),
    ).toBe(groups("672"));
    expect(
      discoverGroupsUrl(
        link(groups("665", "opaque_NEW")),
        subject("665"),
        "665",
      ),
    ).toBe(groups("665", "opaque_NEW"));
  });

  it("resolves safe relative hrefs and tolerates identical duplicates", () => {
    expect(
      discoverGroupsUrl(
        link("/ge/student/me/course/groups/665/47") +
          link(
            "https://classroom.btu.edu.ge/ge/student/me/course/groups/665/47",
          ),
        subject("665"),
        "665",
      ),
    ).toBe(groups("665"));
  });

  it("fails closed for missing, mismatched, or conflicting links", () => {
    expect(
      discoverGroupsUrl("<main>No Groups link</main>", subject("665"), "665"),
    ).toBeNull();
    expect(
      discoverGroupsUrl(link(groups("672")), subject("665"), "665"),
    ).toBeNull();
    expect(
      discoverGroupsUrl(
        link(groups("665")) + link(groups("665", "other")),
        subject("665"),
        "665",
      ),
    ).toBeNull();
    expect(
      discoverGroupsUrl(link(groups("665")), subject("672"), "665"),
    ).toBeNull();
  });

  it.each([
    "http://classroom.btu.edu.ge/ge/student/me/course/groups/665/47",
    "https://classroom.btu.edu.ge.example.com/ge/student/me/course/groups/665/47",
    "https://user:pass@classroom.btu.edu.ge/ge/student/me/course/groups/665/47",
    "https://classroom.btu.edu.ge:444/ge/student/me/course/groups/665/47",
    `${groups("665")}?next=1`,
    `${groups("665")}#section`,
    `${origin}/ge/student/me/course/groups/%36%36%35/47`,
    `${origin}/ge/student/me/course/groups/other/../665/47`,
    `${origin}/ge/student/me/course/groups/665/47/extra`,
    "//evil.example/ge/student/me/course/groups/665/47",
  ])("rejects an unsafe or unsupported href: %s", (href) => {
    expect(discoverGroupsUrl(link(href), subject("665"), "665")).toBeNull();
  });

  it("ignores unrelated links and decoration rather than treating them as Groups routes", () => {
    expect(
      discoverGroupsUrl(
        `<span class="rating">★★★★★ 4.9</span>${link(groups("672"))}${link(groups("665"))}`,
        subject("665"),
        "665",
      ),
    ).toBe(groups("665"));
  });
});
