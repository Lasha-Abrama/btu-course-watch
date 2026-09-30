import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { groupsPageFromUrl, inspectGroupsPage } from "./inspection.js";
import { INSPECT_REQUEST, LINK_START, isInspectRequest } from "./protocol.js";

const groupsUrl =
  "https://classroom.btu.edu.ge/ge/student/me/course/groups/665/47";
const html = readFileSync(
  new URL(
    "../../../packages/classroom-parser/test/fixtures/mixed-groups.html",
    import.meta.url,
  ),
  "utf8",
);

function fetchResponse(body: string, status = 200): Response {
  return new Response(body, { status });
}

describe("BTU Groups URL validation", () => {
  it("extracts only the first confirmed route parameter as an opaque course ID", () => {
    expect(groupsPageFromUrl(groupsUrl)).toEqual({
      url: groupsUrl,
      btuCourseId: "665",
    });
    expect(
      groupsPageFromUrl(
        "https://classroom.btu.edu.ge/ge/student/me/course/groups/COURSE-007/opaque_47",
      ),
    ).toEqual({
      url: "https://classroom.btu.edu.ge/ge/student/me/course/groups/COURSE-007/opaque_47",
      btuCourseId: "COURSE-007",
    });
    expect(
      groupsPageFromUrl(
        "https://classroom.btu.edu.ge/ge/student/me/course/groups/672/47",
      ),
    ).toMatchObject({ btuCourseId: "672" });
  });

  it.each([
    "http://classroom.btu.edu.ge/ge/student/me/course/groups/665/47",
    "https://classroom.btu.edu.ge.example.com/ge/student/me/course/groups/665/47",
    "https://evil.example/ge/student/me/course/groups/665/47",
    "https://user:password@classroom.btu.edu.ge/ge/student/me/course/groups/665/47",
    "chrome://extensions",
  ])("rejects non-Classroom or non-HTTPS origin: %s", (url) => {
    expect(groupsPageFromUrl(url)).toBe("NOT_CLASSROOM");
  });

  it.each([
    "https://classroom.btu.edu.ge/ge/student/me/index/3",
    "https://classroom.btu.edu.ge/ge/student/me/course/665",
    "https://classroom.btu.edu.ge/ge/student/me/course/syllabus/665/47",
    "https://classroom.btu.edu.ge/ge/student/me/course/groups/665",
    "https://classroom.btu.edu.ge/ge/student/me/course/groups//47",
    "https://classroom.btu.edu.ge/ge/student/me/course/groups/665/47/extra",
    "https://classroom.btu.edu.ge/ge/student/me/course/groups/665/47/",
    "https://classroom.btu.edu.ge/ge/student/me/course/groups/665/47?next=1",
    "https://classroom.btu.edu.ge/ge/student/me/course/groups/%36%36%35/47",
    "https://classroom.btu.edu.ge/ge/student/me/course/groups/other/../665/47",
  ])("rejects unsupported Classroom route: %s", (url) => {
    expect(groupsPageFromUrl(url)).toBe("UNSUPPORTED_PAGE");
  });

  it("recognizes a Classroom login tab without fetching it", () => {
    expect(groupsPageFromUrl("https://classroom.btu.edu.ge/ge/login")).toBe(
      "SESSION_REQUIRED",
    );
  });
});

describe("local inspection and message boundary", () => {
  it("accepts only the single fixed inspection message", () => {
    expect(isInspectRequest({ type: INSPECT_REQUEST })).toBe(true);
    expect(isInspectRequest({ type: INSPECT_REQUEST, url: groupsUrl })).toBe(
      false,
    );
    expect(isInspectRequest({ type: "FETCH_URL" })).toBe(false);
  });

  it("does not fetch an unsupported page", async () => {
    const fetchPage = vi.fn();
    expect(
      await inspectGroupsPage(
        "https://classroom.btu.edu.ge/ge/student/me/index/3",
        fetchPage,
      ),
    ).toEqual({ ok: false, error: "UNSUPPORTED_PAGE" });
    expect(
      await inspectGroupsPage(
        "https://classroom.btu.edu.ge/ge/student/me/course/groups/665",
        fetchPage,
      ),
    ).toEqual({ ok: false, error: "UNSUPPORTED_PAGE" });
    expect(fetchPage).not.toHaveBeenCalled();
  });

  it("fetches with browser-managed credentials and sends only structured observation data", async () => {
    const fetchPage = vi.fn().mockResolvedValue(fetchResponse(html));
    const result = await inspectGroupsPage(groupsUrl, fetchPage);
    expect(fetchPage).toHaveBeenCalledOnce();
    expect(fetchPage.mock.calls[0]?.[0]).toBe(groupsUrl);
    expect(fetchPage.mock.calls[0]?.[1]).toMatchObject({
      credentials: "include",
      redirect: "manual",
      cache: "no-store",
    });
    expect(fetchPage.mock.calls[0]?.[1]).not.toHaveProperty("headers");
    expect(result).toMatchObject({
      ok: true,
      observation: {
        btuCourseId: "665",
        courseName: null,
        groups: [{ btuGroupId: "13299" }, { btuGroupId: "13435" }],
      },
    });
    expect(JSON.stringify(result)).not.toContain("<html");
    expect(JSON.stringify(result)).not.toContain("სინთეზური განრიგი");
  });

  it("treats redirects, a login response, and authentication status as session-required", async () => {
    const redirect = vi.fn().mockResolvedValue(fetchResponse("", 302));
    expect(await inspectGroupsPage(groupsUrl, redirect)).toEqual({
      ok: false,
      error: "SESSION_REQUIRED",
    });
    const opaqueRedirect = vi.fn().mockResolvedValue({
      type: "opaqueredirect",
      status: 0,
      redirected: false,
      url: groupsUrl,
    });
    expect(await inspectGroupsPage(groupsUrl, opaqueRedirect)).toEqual({
      ok: false,
      error: "SESSION_REQUIRED",
    });
    const loginUrlResponse = fetchResponse("<html>Login</html>");
    Object.defineProperty(loginUrlResponse, "url", {
      value: "https://classroom.btu.edu.ge/ge/login",
    });
    expect(
      await inspectGroupsPage(
        groupsUrl,
        vi.fn().mockResolvedValue(loginUrlResponse),
      ),
    ).toEqual({ ok: false, error: "SESSION_REQUIRED" });
    const login = vi
      .fn()
      .mockResolvedValue(
        fetchResponse(
          '<form><input type="password"><input type="hidden" value="SECRET_TOKEN"></form>',
        ),
      );
    const result = await inspectGroupsPage(groupsUrl, login);
    expect(result).toEqual({ ok: false, error: "SESSION_REQUIRED" });
    expect(JSON.stringify(result)).not.toContain("SECRET_TOKEN");
    const unauthorized = vi.fn().mockResolvedValue(fetchResponse("", 401));
    expect(await inspectGroupsPage(groupsUrl, unauthorized)).toEqual({
      ok: false,
      error: "SESSION_REQUIRED",
    });
  });

  it("never returns exception text, HTML, or a parser stack in typed errors", async () => {
    const network = vi
      .fn()
      .mockRejectedValue(new Error("Authorization: SECRET_TOKEN"));
    expect(await inspectGroupsPage(groupsUrl, network)).toEqual({
      ok: false,
      error: "REQUEST_FAILED",
    });
    const malformed = vi
      .fn()
      .mockResolvedValue(
        fetchResponse('<a class="group_title">SECRET_TOKEN</a>'),
      );
    expect(await inspectGroupsPage(groupsUrl, malformed)).toEqual({
      ok: false,
      error: "PARSER_FAILED",
    });
  });

  it("lets only the popup trigger the worker and messages back no raw HTML", async () => {
    let listener:
      Parameters<typeof chrome.runtime.onMessage.addListener>[0] | undefined;
    let alarmListener:
      Parameters<typeof chrome.alarms.onAlarm.addListener>[0] | undefined;
    const query = vi.fn().mockResolvedValue([{ url: groupsUrl }]);
    const setStorage = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("chrome", {
      runtime: {
        id: "test-extension",
        getURL: (path: string) => `chrome-extension://test-extension/${path}`,
        onMessage: {
          addListener: (callback: NonNullable<typeof listener>) => {
            listener = callback;
          },
        },
        onInstalled: { addListener: vi.fn() },
        onStartup: { addListener: vi.fn() },
      },
      alarms: {
        get: vi.fn().mockResolvedValue({ periodInMinutes: 30 }),
        create: vi.fn().mockResolvedValue(undefined),
        onAlarm: {
          addListener: (callback: NonNullable<typeof alarmListener>) => {
            alarmListener = callback;
          },
        },
      },
      tabs: { query },
      storage: {
        local: {
          setAccessLevel: vi.fn().mockResolvedValue(undefined),
          get: vi.fn().mockResolvedValue({}),
          set: setStorage,
        },
      },
    });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(fetchResponse(html)));
    try {
      await import("./background.js");
      alarmListener?.({ name: "unrelated-alarm" } as chrome.alarms.Alarm);
      expect(setStorage).not.toHaveBeenCalled();
      alarmListener?.({
        name: "course-watch-observations",
      } as chrome.alarms.Alarm);
      await vi.waitFor(() =>
        expect(setStorage).toHaveBeenCalledWith({
          monitoringHealth: expect.objectContaining({ state: "LINK_REQUIRED" }),
        }),
      );
      expect(fetch).not.toHaveBeenCalled();
      const sendResponse = vi.fn();
      expect(
        listener?.(
          { type: INSPECT_REQUEST },
          { id: "test-extension", url: "https://classroom.btu.edu.ge/" },
          sendResponse,
        ),
      ).toBeUndefined();
      expect(query).not.toHaveBeenCalled();
      expect(
        listener?.(
          { type: LINK_START },
          { id: "test-extension", url: "https://classroom.btu.edu.ge/" },
          sendResponse,
        ),
      ).toBeUndefined();
      expect(
        listener?.(
          { type: LINK_START, redirect: "https://evil.example" },
          {
            id: "test-extension",
            url: "chrome-extension://test-extension/popup.html",
          },
          sendResponse,
        ),
      ).toBeUndefined();
      expect(fetch).not.toHaveBeenCalled();
      expect(
        listener?.(
          { type: INSPECT_REQUEST },
          {
            id: "test-extension",
            url: "chrome-extension://test-extension/popup.html",
          },
          sendResponse,
        ),
      ).toBe(true);
      await vi.waitFor(() => expect(sendResponse).toHaveBeenCalledOnce());
      expect(sendResponse.mock.calls[0]?.[0]).toMatchObject({
        ok: true,
        observation: { btuCourseId: "665" },
        submission: { state: "NOT_LINKED" },
      });
      expect(JSON.stringify(sendResponse.mock.calls[0]?.[0])).not.toContain(
        "<html",
      );
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
