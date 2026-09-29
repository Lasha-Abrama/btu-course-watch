import type { CourseObservation } from "@btu-course-watch/contracts";

export const INSPECT_REQUEST = "INSPECT_GROUPS_PAGE";

export type InspectionError =
  | "NOT_CLASSROOM"
  | "UNSUPPORTED_PAGE"
  | "SESSION_REQUIRED"
  | "REQUEST_FAILED"
  | "PARSER_FAILED";

export type InspectionResult =
  | { ok: true; observation: CourseObservation }
  | { ok: false; error: InspectionError };

export function isInspectRequest(value: unknown): boolean {
  return (
    !!value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.keys(value).length === 1 &&
    "type" in value &&
    value.type === INSPECT_REQUEST
  );
}
