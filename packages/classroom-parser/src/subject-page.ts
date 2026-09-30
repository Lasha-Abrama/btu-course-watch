import { DomUtils, parseDocument } from "htmlparser2";

const CLASSROOM_ORIGIN = "https://classroom.btu.edu.ge";
const EXTERNAL_ID = /^[A-Za-z0-9_-]{1,255}$/u;
const GROUPS_PATH =
  /^\/ge\/student\/me\/course\/groups\/([A-Za-z0-9_-]+)\/([A-Za-z0-9_-]+)$/u;

/** Find one unambiguous, naturally exposed Groups href in fetched subject HTML. */
export function discoverGroupsUrl(
  html: string,
  subjectUrl: string,
  btuCourseId: string,
): string | null {
  if (!EXTERNAL_ID.test(btuCourseId)) return null;
  const expectedSubject = `${CLASSROOM_ORIGIN}/ge/student/me/course/index/${btuCourseId}`;
  if (subjectUrl !== expectedSubject) return null;

  const document = parseDocument(html, { decodeEntities: true });
  const anchors = DomUtils.findAll(
    (element) => element.name === "a" && Object.hasOwn(element.attribs, "href"),
    document,
  );
  const candidates = new Set<string>();
  for (const anchor of anchors) {
    const href = anchor.attribs.href;
    if (
      !href ||
      href !== href.trim() ||
      /[%?#\\]/u.test(href) ||
      /(?:^|\/)\.{1,2}(?:\/|$)/u.test(href)
    )
      continue;
    try {
      const url = new URL(href, subjectUrl);
      const match = GROUPS_PATH.exec(url.pathname);
      if (
        url.origin === CLASSROOM_ORIGIN &&
        !url.username &&
        !url.password &&
        !url.port &&
        !url.search &&
        !url.hash &&
        match?.[1] === btuCourseId &&
        match[2]!.length <= 255
      )
        candidates.add(url.href);
    } catch {
      // An unrelated malformed link cannot become a Groups locator.
    }
  }
  return candidates.size === 1 ? [...candidates][0]! : null;
}
