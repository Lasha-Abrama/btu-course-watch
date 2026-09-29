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
    if (!match) return "UNSUPPORTED_PAGE";
    return { url: url.href, btuCourseId: match[1]! };
  } catch {
    return "NOT_CLASSROOM";
  }
}

type FetchPage = (url: string, init: RequestInit) => Promise<Response>;

/** HTML stays in this worker; only an observation or fixed error crosses the message boundary. */
export async function inspectGroupsPage(
  tabUrl: string | undefined,
  fetchPage: FetchPage = fetch,
): Promise<InspectionResult> {
  const page = groupsPageFromUrl(tabUrl);
  if (typeof page === "string") return { ok: false, error: page };

  let response: Response;
  try {
    response = await fetchPage(page.url, {
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
    (response.url && response.url !== page.url) ||
    response.status === 401 ||
    response.status === 403
  )
    return { ok: false, error: "SESSION_REQUIRED" };
  if (!response.ok) return { ok: false, error: "REQUEST_FAILED" };

  let html: string;
  try {
    html = await response.text();
  } catch {
    return { ok: false, error: "REQUEST_FAILED" };
  }
  if (PASSWORD_INPUT.test(html))
    return { ok: false, error: "SESSION_REQUIRED" };

  try {
    const observation = parseCoursePage(html, {
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
