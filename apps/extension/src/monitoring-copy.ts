import type { MonitoringFailure, MonitoringHealth } from "./monitoring.js";

const failureCopy: Record<MonitoringFailure, string> = {
  BTU_SESSION_REQUIRED: "Sign in to BTU Classroom in Chrome.",
  ROUTE_DISCOVERY_UNAVAILABLE:
    "The Groups link could not be confirmed; open the subject in Classroom.",
  CLASSROOM_REQUEST_FAILED: "Classroom could not be reached.",
  PARSER_FAILED: "The Groups page could not be safely interpreted.",
  SUBMISSION_FAILED:
    "Course Watch did not accept the observation; it will retry.",
  WATCHED_GROUP_MISSING:
    "A watched group was absent from this scan; its last-known state was not removed.",
};

export function monitoringCopy(health: MonitoringHealth): string {
  switch (health.state) {
    case "WAITING":
      return "Browser-assisted checks are waiting for the next scheduled run.";
    case "NO_WATCHES":
      return "No watched courses to check.";
    case "LINK_REQUIRED":
      return "Connect Course Watch to enable browser-assisted checks.";
    case "COURSE_WATCH_UNAVAILABLE":
      return "Could not load your watched courses. Checks will retry when Chrome is running.";
    default: {
      const count = `${health.submittedCourseCount} of ${health.attemptedCourseCount} course checks submitted`;
      const failures = health.failures.map(
        ({ btuCourseId, reason }) =>
          `Course ${btuCourseId}: ${failureCopy[reason]}`,
      );
      return `${count} in the last automatic cycle.${failures.length ? ` ${failures.join(" ")}` : ""}`;
    }
  }
}
