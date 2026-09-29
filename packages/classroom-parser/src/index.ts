import { DomUtils, parseDocument } from "htmlparser2";
import {
  assertCourseObservation,
  isBtuChooseUrl,
  type CourseObservation,
  type GroupObservation,
} from "@btu-course-watch/contracts";

type HtmlElement = ReturnType<typeof DomUtils.findAll>[number];

export interface CoursePageContext {
  btuCourseId: string;
  /** Caller-supplied UTC ISO timestamp; the parser never reads the clock. */
  observedAt: string;
  /** Optional metadata from the caller, not inferred from unconfirmed page markup. */
  courseName?: string | null;
}

function hasClass(element: HtmlElement, className: string): boolean {
  return (element.attribs.class ?? "").split(/\s+/u).includes(className);
}

function isHidden(element: HtmlElement): boolean {
  let current: HtmlElement | typeof element.parent = element;
  while (current) {
    if ("attribs" in current) {
      const attrs = current.attribs;
      if (Object.hasOwn(attrs, "hidden") || attrs["aria-hidden"] === "true")
        return true;
      if (/(?:^|;)\s*display\s*:\s*none\s*(?:;|$)/iu.test(attrs.style ?? ""))
        return true;
    }
    current = current.parent;
  }
  return false;
}

function containingRow(element: HtmlElement): HtmlElement | null {
  let current: HtmlElement | typeof element.parent = element;
  while (current) {
    if ("name" in current && current.name === "tr")
      return current as HtmlElement;
    current = current.parent;
  }
  return null;
}

function readableText(value: string): string {
  return value.replace(/\s+/gu, " ").trim();
}

function titleParts(
  element: HtmlElement,
): Pick<GroupObservation, "name" | "capacity"> {
  const title = readableText(DomUtils.textContent(element));
  const match = /^(.*?)\s*-\s*\(\s*(\d+)\s*\)$/u.exec(title);
  if (match) {
    const capacity = Number(match[2]);
    const name = readableText(match[1] ?? "");
    if (name && Number.isSafeInteger(capacity)) return { name, capacity };
  }
  // Preserve the human-readable title without interpreting an unknown suffix.
  return { name: title || null, capacity: null };
}

function groupAction(
  row: HtmlElement | null,
): Pick<GroupObservation, "status" | "chooseUrl"> {
  if (!row) return { status: "UNKNOWN", chooseUrl: null };
  const titles = DomUtils.findAll(
    (element) =>
      hasClass(element, "group_title") &&
      !isHidden(element) &&
      containingRow(element) === row,
    row,
  );
  if (titles.length !== 1) return { status: "UNKNOWN", chooseUrl: null };

  const controls = DomUtils.findAll(
    (element) =>
      element.name === "a" &&
      hasClass(element, "chooseGroup") &&
      !isHidden(element) &&
      containingRow(element) === row,
    row,
  );
  if (controls.length !== 1) return { status: "UNKNOWN", chooseUrl: null };

  const control = controls[0]!;
  const disabled = Object.hasOwn(control.attribs, "disabled");
  const effectivelyDisabled =
    disabled ||
    control.attribs["aria-disabled"] === "true" ||
    hasClass(control, "disabled");
  const exposedUrl = control.attribs["data-href"]?.trim() || null;

  if (disabled && hasClass(control, "btn-default") && !exposedUrl) {
    return { status: "FULL", chooseUrl: null };
  }
  if (
    !effectivelyDisabled &&
    hasClass(control, "btn-primary") &&
    control.attribs["data-type"] === "choose" &&
    isBtuChooseUrl(exposedUrl)
  ) {
    return { status: "AVAILABLE", chooseUrl: exposedUrl };
  }
  return { status: "UNKNOWN", chooseUrl: null };
}

/**
 * Parse an already-obtained BTU Classroom course page. No network, browser
 * globals, cookies, credentials, backend state, or implicit time source.
 */
export function parseCoursePage(
  html: string,
  context: CoursePageContext,
): CourseObservation {
  if (typeof html !== "string") throw new TypeError("Expected HTML string");
  const document = parseDocument(html, { decodeEntities: true });
  const titles = DomUtils.findAll(
    (element) => hasClass(element, "group_title") && !isHidden(element),
    document,
  );

  const groups: GroupObservation[] = titles.map((title) => {
    const btuGroupId = title.attribs["data-id"]?.trim();
    if (!btuGroupId) throw new TypeError("Visible group title missing data-id");
    return {
      btuGroupId,
      ...titleParts(title),
      ...groupAction(containingRow(title)),
    };
  });
  groups.sort((left, right) =>
    left.btuGroupId < right.btuGroupId
      ? -1
      : left.btuGroupId > right.btuGroupId
        ? 1
        : 0,
  );

  const observation: CourseObservation = {
    btuCourseId: context.btuCourseId.trim(),
    observedAt: context.observedAt,
    courseName: context.courseName?.trim() || null,
    groups,
  };
  assertCourseObservation(observation);
  return observation;
}
