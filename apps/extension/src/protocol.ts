import type { CourseObservation } from "@btu-course-watch/contracts";
import type { LinkState, SubmissionResult } from "./account.js";

export const INSPECT_REQUEST = "INSPECT_GROUPS_PAGE";
export const LINK_START = "LINK_START";
export const LINK_STATUS = "LINK_STATUS";

export type InspectionError =
  | "NOT_CLASSROOM"
  | "UNSUPPORTED_PAGE"
  | "SESSION_REQUIRED"
  | "REQUEST_FAILED"
  | "PARSER_FAILED";

export type InspectionResult =
  | { ok: true; observation: CourseObservation }
  | { ok: false; error: InspectionError };

export type InspectionSubmissionResult =
  | { ok: true; observation: CourseObservation; submission: SubmissionResult }
  | { ok: false; error: InspectionError };

export type LinkResult =
  { ok: true; link: LinkState } | { ok: false; error: "LINK_FAILED" };

export function isPopupRequest(value: unknown): value is { type: string } {
  return (
    !!value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.keys(value).length === 1 &&
    "type" in value &&
    (value.type === INSPECT_REQUEST ||
      value.type === LINK_START ||
      value.type === LINK_STATUS)
  );
}

export function isInspectRequest(value: unknown): boolean {
  return isPopupRequest(value) && value.type === INSPECT_REQUEST;
}
