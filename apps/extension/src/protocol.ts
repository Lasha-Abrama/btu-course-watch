import type {
  CourseObservation,
  WatchCreateRequest,
  WatchResponse,
} from "@btu-course-watch/contracts";
import type { LinkState, SubmissionResult, WatchResult } from "./account.js";
import type { MonitoringHealth } from "./monitoring.js";

export const INSPECT_REQUEST = "INSPECT_GROUPS_PAGE";
export const LINK_START = "LINK_START";
export const LINK_STATUS = "LINK_STATUS";
export const WATCH_GROUP = "WATCH_GROUP";
export const UNWATCH_GROUP = "UNWATCH_GROUP";
export const MONITOR_STATUS = "MONITOR_STATUS";

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
  | {
      ok: true;
      observation: CourseObservation;
      submission: SubmissionResult;
      watches: WatchResult;
    }
  | { ok: false; error: InspectionError };

export type LinkResult =
  { ok: true; link: LinkState } | { ok: false; error: "LINK_FAILED" };

export type WatchMessageResult =
  { ok: true; watches: WatchResult } | { ok: false; error: "REQUEST_FAILED" };

export type MonitorStatusResult =
  | { ok: true; health: MonitoringHealth }
  | { ok: false; error: "REQUEST_FAILED" };

export type PopupRequest =
  | {
      type:
        | typeof INSPECT_REQUEST
        | typeof LINK_START
        | typeof LINK_STATUS
        | typeof MONITOR_STATUS;
    }
  | { type: typeof WATCH_GROUP; group: WatchCreateRequest }
  | { type: typeof UNWATCH_GROUP; watchId: string };

const externalId = /^[A-Za-z0-9_-]{1,255}$/;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isPopupRequest(value: unknown): value is PopupRequest {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const message = value as Record<string, unknown>;
  if (
    [INSPECT_REQUEST, LINK_START, LINK_STATUS, MONITOR_STATUS].includes(
      message.type as string,
    )
  )
    return Object.keys(message).length === 1;
  if (message.type === WATCH_GROUP) {
    if (
      Object.keys(message).length !== 2 ||
      !message.group ||
      typeof message.group !== "object" ||
      Array.isArray(message.group)
    )
      return false;
    const group = message.group as Record<string, unknown>;
    return (
      Object.keys(group).length === 2 &&
      typeof group.btuCourseId === "string" &&
      externalId.test(group.btuCourseId) &&
      typeof group.btuGroupId === "string" &&
      externalId.test(group.btuGroupId)
    );
  }
  return (
    message.type === UNWATCH_GROUP &&
    Object.keys(message).length === 2 &&
    typeof message.watchId === "string" &&
    uuid.test(message.watchId)
  );
}

export function isInspectRequest(value: unknown): boolean {
  return isPopupRequest(value) && value.type === INSPECT_REQUEST;
}

export function watchForGroup(
  watches: WatchResponse[],
  btuCourseId: string,
  btuGroupId: string,
): WatchResponse | undefined {
  return watches.find(
    (watch) =>
      watch.btuCourseId === btuCourseId && watch.btuGroupId === btuGroupId,
  );
}
