import { discoverGroupsUrl } from "@btu-course-watch/classroom-parser";
import type {
  CourseObservation,
  WatchResponse,
} from "@btu-course-watch/contracts";
import {
  listWatches,
  submitObservation,
  type SubmissionResult,
  type WatchResult,
} from "./account.js";
import {
  fetchClassroomHtml,
  inspectGroupsPage,
  type FetchPage,
} from "./inspection.js";
import { CURSOR_KEY, HEALTH_KEY } from "./monitoring-storage.js";

export const MONITOR_ALARM = "course-watch-observations";
export const MONITOR_INTERVAL_MINUTES = 30;
export const MAX_COURSES_PER_CYCLE = 4;
const SESSION_RETRY_MS = 2 * 60 * 60_000;
const EXTERNAL_ID = /^[A-Za-z0-9_-]{1,255}$/u;

export type MonitoringFailure =
  | "BTU_SESSION_REQUIRED"
  | "ROUTE_DISCOVERY_UNAVAILABLE"
  | "CLASSROOM_REQUEST_FAILED"
  | "PARSER_FAILED"
  | "SUBMISSION_FAILED"
  | "WATCHED_GROUP_MISSING";

export interface MonitoringHealth {
  state:
    | "WAITING"
    | "NO_WATCHES"
    | "LINK_REQUIRED"
    | "COURSE_WATCH_UNAVAILABLE"
    | "CHECKED"
    | "PARTIAL_FAILURE"
    | "FAILED";
  /** Last scheduled attempt that actually reached a Classroom course. */
  lastAttemptAt: string | null;
  /** Observation time of the latest successfully submitted scheduled scan. */
  lastSuccessfulObservationAt: string | null;
  watchedCourseCount: number;
  attemptedCourseCount: number;
  submittedCourseCount: number;
  failures: Array<{ btuCourseId: string; reason: MonitoringFailure }>;
  nextBtuRetryAt: string | null;
}

const initialHealth: MonitoringHealth = {
  state: "WAITING",
  lastAttemptAt: null,
  lastSuccessfulObservationAt: null,
  watchedCourseCount: 0,
  attemptedCourseCount: 0,
  submittedCourseCount: 0,
  failures: [],
  nextBtuRetryAt: null,
};

type Storage = {
  get(key: string): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
};
type AlarmApi = Pick<typeof chrome.alarms, "get" | "create">;
type CourseCheck =
  | { ok: true; observation: CourseObservation }
  | { ok: false; reason: MonitoringFailure };

export async function ensureMonitoringAlarm(
  alarms: AlarmApi = chrome.alarms,
  random: () => number = Math.random,
): Promise<void> {
  const existing = await alarms.get(MONITOR_ALARM);
  if (existing?.periodInMinutes === MONITOR_INTERVAL_MINUTES) return;
  // One initial, bounded jitter offset; no worker keep-alive timer.
  await alarms.create(MONITOR_ALARM, {
    delayInMinutes:
      MONITOR_INTERVAL_MINUTES + Math.min(1, Math.max(0, random())) * 5,
    periodInMinutes: MONITOR_INTERVAL_MINUTES,
  });
}

export async function readMonitoringHealth(
  storage: Storage = chrome.storage.local,
): Promise<MonitoringHealth> {
  const raw = (await storage.get(HEALTH_KEY))[HEALTH_KEY];
  if (!raw || typeof raw !== "object" || Array.isArray(raw))
    return initialHealth;
  const value = raw as MonitoringHealth;
  if (
    ![
      "WAITING",
      "NO_WATCHES",
      "LINK_REQUIRED",
      "COURSE_WATCH_UNAVAILABLE",
      "CHECKED",
      "PARTIAL_FAILURE",
      "FAILED",
    ].includes(value.state)
  )
    return initialHealth;
  return value;
}

export async function inspectWatchedCourse(
  btuCourseId: string,
  fetchPage: FetchPage = fetch,
): Promise<CourseCheck> {
  if (!EXTERNAL_ID.test(btuCourseId))
    return { ok: false, reason: "ROUTE_DISCOVERY_UNAVAILABLE" };
  const subjectUrl = `https://classroom.btu.edu.ge/ge/student/me/course/index/${encodeURIComponent(btuCourseId)}`;
  const subject = await fetchClassroomHtml(subjectUrl, fetchPage);
  if (!subject.ok)
    return {
      ok: false,
      reason:
        subject.error === "SESSION_REQUIRED"
          ? "BTU_SESSION_REQUIRED"
          : subject.status === 404
            ? "ROUTE_DISCOVERY_UNAVAILABLE"
            : "CLASSROOM_REQUEST_FAILED",
    };
  const groupsUrl = discoverGroupsUrl(subject.html, subjectUrl, btuCourseId);
  if (!groupsUrl) return { ok: false, reason: "ROUTE_DISCOVERY_UNAVAILABLE" };
  const result = await inspectGroupsPage(groupsUrl, fetchPage);
  if (!result.ok)
    return {
      ok: false,
      reason:
        result.error === "SESSION_REQUIRED"
          ? "BTU_SESSION_REQUIRED"
          : result.error === "REQUEST_FAILED"
            ? "CLASSROOM_REQUEST_FAILED"
            : "PARSER_FAILED",
    };
  return result;
}

function targets(watches: WatchResponse[]): Map<string, Set<string>> | null {
  const result = new Map<string, Set<string>>();
  for (const watch of watches) {
    if (
      !watch ||
      typeof watch.btuCourseId !== "string" ||
      typeof watch.btuGroupId !== "string" ||
      !EXTERNAL_ID.test(watch.btuCourseId) ||
      !EXTERNAL_ID.test(watch.btuGroupId)
    )
      return null;
    const groups = result.get(watch.btuCourseId) ?? new Set<string>();
    groups.add(watch.btuGroupId);
    result.set(watch.btuCourseId, groups);
  }
  return result;
}

interface CycleDeps {
  storage?: Storage;
  list?: () => Promise<WatchResult>;
  inspect?: (btuCourseId: string) => Promise<CourseCheck>;
  submit?: (observation: CourseObservation) => Promise<SubmissionResult>;
  now?: () => Date;
}

/** One bounded best-effort alarm cycle; all durable state lives in storage/API. */
export async function runMonitoringCycle(
  deps: CycleDeps = {},
): Promise<MonitoringHealth> {
  const storage = deps.storage ?? chrome.storage.local;
  const now = deps.now ?? (() => new Date());
  const previous = await readMonitoringHealth(storage);
  const health: MonitoringHealth = {
    ...initialHealth,
    failures: [],
    lastAttemptAt: previous.lastAttemptAt,
    lastSuccessfulObservationAt: previous.lastSuccessfulObservationAt,
  };
  const save = async () => {
    await storage.set({ [HEALTH_KEY]: health });
    return health;
  };

  let listed: WatchResult;
  try {
    listed = await (deps.list ?? listWatches)();
  } catch {
    health.state = "COURSE_WATCH_UNAVAILABLE";
    return save();
  }
  if (listed.state === "NOT_LINKED" || listed.state === "AUTH_REQUIRED") {
    Object.assign(health, initialHealth, {
      state: "LINK_REQUIRED",
      failures: [],
    });
    return save();
  }
  if (listed.state !== "READY") {
    health.state = "COURSE_WATCH_UNAVAILABLE";
    return save();
  }
  const byCourse = targets(listed.watches);
  if (!byCourse) {
    health.state = "COURSE_WATCH_UNAVAILABLE";
    return save();
  }
  const courseIds = [...byCourse.keys()].sort();
  health.watchedCourseCount = courseIds.length;
  if (courseIds.length === 0) {
    health.state = "NO_WATCHES";
    await storage.set({ [CURSOR_KEY]: 0 });
    return save();
  }
  if (
    previous.nextBtuRetryAt &&
    Date.parse(previous.nextBtuRetryAt) > now().getTime()
  ) {
    health.state = "FAILED";
    health.nextBtuRetryAt = previous.nextBtuRetryAt;
    health.failures = previous.failures;
    return save();
  }

  const rawCursor = (await storage.get(CURSOR_KEY))[CURSOR_KEY];
  const cursor =
    typeof rawCursor === "number" &&
    Number.isSafeInteger(rawCursor) &&
    rawCursor >= 0
      ? rawCursor % courseIds.length
      : 0;
  const count = Math.min(MAX_COURSES_PER_CYCLE, courseIds.length);
  const selected = Array.from(
    { length: count },
    (_, index) => courseIds[(cursor + index) % courseIds.length]!,
  );
  await storage.set({ [CURSOR_KEY]: (cursor + count) % courseIds.length });
  health.lastAttemptAt = now().toISOString();

  for (const btuCourseId of selected) {
    health.attemptedCourseCount++;
    let result: CourseCheck;
    try {
      result = await (deps.inspect ?? inspectWatchedCourse)(btuCourseId);
    } catch {
      result = { ok: false, reason: "CLASSROOM_REQUEST_FAILED" };
    }
    if (!result.ok) {
      health.failures.push({ btuCourseId, reason: result.reason });
      if (result.reason === "BTU_SESSION_REQUIRED") {
        health.nextBtuRetryAt = new Date(
          now().getTime() + SESSION_RETRY_MS,
        ).toISOString();
        break;
      }
      continue;
    }
    let submission: SubmissionResult;
    try {
      submission = await (deps.submit ?? submitObservation)(result.observation);
    } catch {
      submission = { state: "SUBMISSION_FAILED" };
    }
    if (
      submission.state === "AUTH_REQUIRED" ||
      submission.state === "NOT_LINKED"
    ) {
      Object.assign(health, initialHealth, {
        state: "LINK_REQUIRED",
        failures: [],
      });
      return save();
    }
    if (submission.state !== "SUBMITTED") {
      health.failures.push({ btuCourseId, reason: "SUBMISSION_FAILED" });
      break;
    }
    health.submittedCourseCount++;
    if (
      !health.lastSuccessfulObservationAt ||
      result.observation.observedAt > health.lastSuccessfulObservationAt
    )
      health.lastSuccessfulObservationAt = result.observation.observedAt;
    const seen = new Set(
      result.observation.groups.map((group) => group.btuGroupId),
    );
    if ([...byCourse.get(btuCourseId)!].some((id) => !seen.has(id)))
      health.failures.push({ btuCourseId, reason: "WATCHED_GROUP_MISSING" });
  }
  health.state =
    health.failures.length === 0
      ? "CHECKED"
      : health.submittedCourseCount > 0
        ? "PARTIAL_FAILURE"
        : "FAILED";
  return save();
}
