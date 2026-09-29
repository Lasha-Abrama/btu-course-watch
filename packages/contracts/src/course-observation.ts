/** A snapshot of one BTU Classroom course page, not a persisted course model. */
export interface CourseObservation {
  btuCourseId: string;
  /** Canonical UTC ISO-8601 timestamp supplied by the caller. */
  observedAt: string;
  /** Caller-provided course name, if known; this parser does not infer one. */
  courseName: string | null;
  groups: GroupObservation[];
}

export type GroupAvailabilityStatus = "AVAILABLE" | "FULL" | "UNKNOWN";

export interface GroupObservation {
  /** Stable external key taken from .group_title[data-id]. */
  btuGroupId: string;
  /** Human-readable title without the confirmed capacity suffix, if available. */
  name: string | null;
  capacity: number | null;
  status: GroupAvailabilityStatus;
  /** Exact, validated BTU URL exposed by the Choose control; never derived from an ID. */
  chooseUrl: string | null;
}

const CHOOSE_PATH = /^\/ge\/student\/me\/choose\/[0-9]+$/;

export function isBtuChooseUrl(value: unknown): value is string {
  if (typeof value !== "string" || value !== value.trim()) return false;
  try {
    const url = new URL(value);
    return (
      url.href === value &&
      url.origin === "https://classroom.btu.edu.ge" &&
      url.username === "" &&
      url.password === "" &&
      url.search === "" &&
      url.hash === "" &&
      CHOOSE_PATH.test(url.pathname)
    );
  } catch {
    return false;
  }
}

function nonEmptyString(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.trim().length > 0 &&
    value === value.trim()
  );
}

function canonicalTimestamp(value: unknown): value is string {
  if (typeof value !== "string") return false;
  try {
    return new Date(value).toISOString() === value;
  } catch {
    return false;
  }
}

/** Validate a serializable observation at a future extension/API boundary. */
export function assertCourseObservation(
  value: unknown,
): asserts value is CourseObservation {
  if (!value || typeof value !== "object")
    throw new TypeError("Invalid course observation");
  const observation = value as Record<string, unknown>;
  if (!nonEmptyString(observation.btuCourseId))
    throw new TypeError("Invalid btuCourseId");
  if (!canonicalTimestamp(observation.observedAt))
    throw new TypeError("Invalid observedAt");
  if (
    observation.courseName !== null &&
    !nonEmptyString(observation.courseName)
  ) {
    throw new TypeError("Invalid courseName");
  }
  if (!Array.isArray(observation.groups)) throw new TypeError("Invalid groups");

  const seen = new Set<string>();
  for (const item of observation.groups) {
    if (!item || typeof item !== "object") throw new TypeError("Invalid group");
    const group = item as Record<string, unknown>;
    if (!nonEmptyString(group.btuGroupId))
      throw new TypeError("Invalid btuGroupId");
    if (seen.has(group.btuGroupId)) throw new TypeError("Duplicate btuGroupId");
    seen.add(group.btuGroupId);
    if (group.name !== null && !nonEmptyString(group.name))
      throw new TypeError("Invalid group name");
    if (
      group.capacity !== null &&
      (!Number.isSafeInteger(group.capacity) || (group.capacity as number) < 0)
    ) {
      throw new TypeError("Invalid group capacity");
    }
    if (group.status === "AVAILABLE") {
      if (!isBtuChooseUrl(group.chooseUrl))
        throw new TypeError("AVAILABLE requires a BTU choose URL");
    } else if (group.status === "FULL" || group.status === "UNKNOWN") {
      if (group.chooseUrl !== null)
        throw new TypeError("Non-available group cannot expose a choose URL");
    } else {
      throw new TypeError("Invalid group status");
    }
  }
}
