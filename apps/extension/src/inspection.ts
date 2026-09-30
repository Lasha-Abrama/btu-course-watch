import { parseCoursePage } from "@btu-course-watch/classroom-parser";
import type { InspectionError, InspectionResult } from "./protocol.js";

interface GroupsPage {
  url: string;
  btuCourseId: string;
}

// The second route segment is only checked for shape; its meaning is unknown.
const GROUPS_PATH =
  /^\/ge\/student\/me\/course\/groups\/([A-Za-z0-9_-]+)\/([A-Za-z0-9_-]+)$/u;
const PASSWORD_INPUT =
  /<input\b[^>]*\btype\s*=\s*(?:"password"|'password'|password)(?=[\s/>])/iu;

export function groupsPageFromUrl(
  raw: string | undefined,
): GroupsPage | InspectionError {
  if (!raw) return "NOT_CLASSROOM";
  try {
    const url = new URL(raw);
    if (
      url.origin !== "https://classroom.btu.edu.ge" ||
      url.username ||
      url.password
    )
      return "NOT_CLASSROOM";
    if (url.pathname === "/ge/login" || url.pathname === "/ge/login/")
      return "SESSION_REQUIRED";
    if (url.href !== raw || url.search || url.hash) return "UNSUPPORTED_PAGE";
    const match = GROUPS_PATH.exec(url.pathname);
    if (!match || match[1]!.length > 255 || match[2]!.length > 255)
      return "UNSUPPORTED_PAGE";
    return { url: url.href, btuCourseId: match[1]! };
  } catch {
    return "NOT_CLASSROOM";
  }
}

export type FetchPage = (url: string, init: RequestInit) => Promise<Response>;

/** Only a sanitized result leaves this worker-local authenticated fetch boundary. */
export async function fetchClassroomHtml(
  url: string,
  fetchPage: FetchPage = fetch,
): Promise<
  | { ok: true; html: string }
  | { ok: false; error: "SESSION_REQUIRED" | "REQUEST_FAILED"; status?: number }
> {
  let response: Response;
  try {
    response = await fetchPage(url, {
      credentials: "include",
      cache: "no-store",
      redirect: "manual",
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    return { ok: false, error: "REQUEST_FAILED" };
  }

  if (
    response.type === "opaqueredirect" ||
    response.redirected ||
    (response.status >= 300 && response.status < 400) ||
    (response.url && response.url !== url) ||
    response.status === 401 ||
    response.status === 403
  )
    return { ok: false, error: "SESSION_REQUIRED" };
  if (!response.ok)
    return { ok: false, error: "REQUEST_FAILED", status: response.status };

  try {
    const html = await response.text();
    if (PASSWORD_INPUT.test(html))
      return { ok: false, error: "SESSION_REQUIRED" };
    return { ok: true, html };
  } catch {
    return { ok: false, error: "REQUEST_FAILED" };
  }
}

/** HTML stays in this worker; only an observation or fixed error crosses the message boundary. */
export async function inspectGroupsPage(
  tabUrl: string | undefined,
  fetchPage: FetchPage = fetch,
): Promise<InspectionResult> {
  const page = groupsPageFromUrl(tabUrl);
  if (typeof page === "string") return { ok: false, error: page };

  const fetched = await fetchClassroomHtml(page.url, fetchPage);
  if (!fetched.ok) return { ok: false, error: fetched.error };

  try {
    const observation = parseCoursePage(fetched.html, {
      btuCourseId: page.btuCourseId,
      observedAt: new Date().toISOString(),
    });
    if (observation.groups.length === 0)
      return { ok: false, error: "PARSER_FAILED" };
    return { ok: true, observation };
  } catch {
    return { ok: false, error: "PARSER_FAILED" };
  }
}
