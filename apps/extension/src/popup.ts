import "./popup.css";
import type {
  CourseObservation,
  WatchResponse,
} from "@btu-course-watch/contracts";
import {
  INSPECT_REQUEST,
  LINK_START,
  LINK_STATUS,
  MONITOR_STATUS,
  UNWATCH_GROUP,
  WATCH_GROUP,
  type LinkResult,
  type MonitorStatusResult,
  type InspectionError,
  type InspectionSubmissionResult,
  type WatchMessageResult,
  watchForGroup,
} from "./protocol.js";
import { monitoringCopy } from "./monitoring-copy.js";

const status = document.querySelector<HTMLParagraphElement>("#status");
const button = document.querySelector<HTMLButtonElement>("#inspect");
const results = document.querySelector<HTMLElement>("#results");
const summary = document.querySelector<HTMLParagraphElement>("#summary");
const groups = document.querySelector<HTMLUListElement>("#groups");
const linkStatusText =
  document.querySelector<HTMLParagraphElement>("#link-status");
const linkButton = document.querySelector<HTMLButtonElement>("#link");
const checkLinkButton =
  document.querySelector<HTMLButtonElement>("#check-link");
const monitoringStatus =
  document.querySelector<HTMLParagraphElement>("#monitoring-status");
const monitoringTimes =
  document.querySelector<HTMLParagraphElement>("#monitoring-times");
let currentWatches: WatchResponse[] = [];
let watchReady = false;

if (
  !status ||
  !button ||
  !results ||
  !summary ||
  !groups ||
  !linkStatusText ||
  !linkButton ||
  !checkLinkButton ||
  !monitoringStatus ||
  !monitoringTimes
) {
  throw new Error("Popup elements are missing.");
}

async function updateLink(type: typeof LINK_START | typeof LINK_STATUS) {
  linkButton!.disabled = true;
  checkLinkButton!.disabled = true;
  linkStatusText!.textContent =
    type === LINK_START ? "Opening authorization…" : "Checking authorization…";
  try {
    const response = (await chrome.runtime.sendMessage({ type })) as LinkResult;
    if (!response?.ok) throw new Error("LINK_FAILED");
    linkButton!.hidden = response.link.state !== "NOT_LINKED";
    checkLinkButton!.hidden = response.link.state !== "PENDING";
    linkStatusText!.textContent =
      response.link.state === "LINKED"
        ? `Course Watch connected until ${new Date(response.link.expiresAt).toLocaleDateString()}.`
        : response.link.state === "PENDING"
          ? `Approve in the Course Watch tab. Match code ${response.link.pairingCode}, then check authorization.`
          : "Not connected to Course Watch. Local inspection still works.";
  } catch {
    linkStatusText!.textContent =
      "Could not check Course Watch connection. Try again.";
    checkLinkButton!.hidden = false;
  } finally {
    linkButton!.disabled = false;
    checkLinkButton!.disabled = false;
  }
}

linkButton.addEventListener("click", () => void updateLink(LINK_START));
checkLinkButton.addEventListener("click", () => void updateLink(LINK_STATUS));
void updateLink(LINK_STATUS);

async function updateMonitoring(): Promise<void> {
  try {
    const response = (await chrome.runtime.sendMessage({
      type: MONITOR_STATUS,
    })) as MonitorStatusResult | undefined;
    if (!response?.ok) throw new Error("MONITOR_STATUS_FAILED");
    monitoringStatus!.textContent = monitoringCopy(response.health);
    const lastAttempt = response.health.lastAttemptAt
      ? new Date(response.health.lastAttemptAt).toLocaleString()
      : "none yet";
    const lastSuccess = response.health.lastSuccessfulObservationAt
      ? new Date(response.health.lastSuccessfulObservationAt).toLocaleString()
      : "none yet";
    monitoringTimes!.textContent = `Last automatic attempt: ${lastAttempt}. Last successful automatic observation: ${lastSuccess}.`;
    if (response.health.nextBtuRetryAt)
      monitoringTimes!.textContent += ` BTU checks paused until ${new Date(response.health.nextBtuRetryAt).toLocaleString()}.`;
  } catch {
    monitoringStatus!.textContent =
      "Check status could not be loaded. Reopen the extension to retry.";
  }
}
void updateMonitoring();

const errorMessages: Record<InspectionError, string> = {
  NOT_CLASSROOM: "Open BTU Classroom in the active tab first.",
  UNSUPPORTED_PAGE:
    "This Classroom page URL is unsupported. Reopen the subject normally, then use its Groups tab.",
  SESSION_REQUIRED:
    "Your Classroom session appears to have expired. Sign in there and retry.",
  REQUEST_FAILED:
    "Could not load the Groups page. Check your connection and try again.",
  PARSER_FAILED: "This Groups page has unsupported or incomplete markup.",
};

function renderObservation(observation: CourseObservation): void {
  summary!.textContent = `Course ID: ${observation.btuCourseId} · Observed: ${observation.observedAt} · Groups: ${observation.groups.length}`;
  groups!.replaceChildren();
  for (const group of observation.groups) {
    const item = document.createElement("li");
    const title = document.createElement("strong");
    title.textContent = `${group.name ?? "Unnamed group"} · ID ${group.btuGroupId}`;
    const details = document.createElement("span");
    details.textContent = `Capacity: ${group.capacity ?? "unknown"} · Availability: ${group.status} · Choose action: ${group.chooseUrl ? "present" : "none"}`;
    item.append(title, details);
    const watch = watchForGroup(
      currentWatches,
      observation.btuCourseId,
      group.btuGroupId,
    );
    const watchButton = document.createElement("button");
    watchButton.type = "button";
    watchButton.textContent = watch ? "Watching · remove" : "Watch group";
    watchButton.disabled = !watchReady;
    watchButton.setAttribute(
      "aria-label",
      `${watch ? "Stop watching" : "Watch"} ${group.name ?? group.btuGroupId}`,
    );
    watchButton.addEventListener("click", async () => {
      watchButton.disabled = true;
      status!.textContent = "Updating your Course Watch watch…";
      try {
        const response = (await chrome.runtime.sendMessage(
          watch
            ? { type: UNWATCH_GROUP, watchId: watch.id }
            : {
                type: WATCH_GROUP,
                group: {
                  btuCourseId: observation.btuCourseId,
                  btuGroupId: group.btuGroupId,
                },
              },
        )) as WatchMessageResult | undefined;
        const watchResult = response?.ok ? response.watches : null;
        if (!watchResult || watchResult.state === "REQUEST_FAILED") {
          status!.textContent =
            "Local inspection is still available, but your watch change failed. Try again.";
        } else if (
          watchResult.state === "AUTH_REQUIRED" ||
          watchResult.state === "NOT_LINKED"
        ) {
          watchReady = false;
          status!.textContent =
            "Course Watch authorization expired or was revoked. Connect again to manage watches.";
          void updateLink(LINK_STATUS);
        } else if (watchResult.state === "READY") {
          currentWatches = watchResult.watches;
          status!.textContent =
            "Watch state updated on Course Watch. This does not enroll you or imply current availability.";
        }
      } catch {
        status!.textContent =
          "Local inspection is still available, but your watch change failed. Try again.";
      }
      renderObservation(observation);
    });
    item.append(watchButton);
    groups!.append(item);
  }
  results!.hidden = false;
}

button.addEventListener("click", async () => {
  button.disabled = true;
  status.textContent = "Inspecting the current Groups page…";
  results.hidden = true;
  try {
    const response = (await chrome.runtime.sendMessage({
      type: INSPECT_REQUEST,
    })) as InspectionSubmissionResult | undefined;
    if (!response || typeof response !== "object") {
      status.textContent = errorMessages.REQUEST_FAILED;
    } else if (response.ok) {
      watchReady = response.watches.state === "READY";
      currentWatches =
        response.watches.state === "READY" ? response.watches.watches : [];
      renderObservation(response.observation);
      status.textContent =
        response.submission.state === "SUBMITTED"
          ? "Inspection complete. Structured observation submitted to Course Watch."
          : response.submission.state === "NOT_LINKED"
            ? "Inspection complete locally. Connect Course Watch to submit."
            : response.submission.state === "AUTH_REQUIRED"
              ? "Inspection complete locally. Course Watch authorization expired or was revoked; connect again."
              : "Inspection complete locally, but submission failed. Retry when Course Watch is reachable.";
      if (response.submission.state === "AUTH_REQUIRED")
        void updateLink(LINK_STATUS);
      else if (
        response.submission.state === "SUBMITTED" &&
        response.watches.state !== "READY"
      )
        status.textContent +=
          " Watch state could not be loaded; retry inspection before managing watches.";
    } else {
      status.textContent =
        errorMessages[response.error] ?? errorMessages.REQUEST_FAILED;
    }
  } catch {
    status.textContent = errorMessages.REQUEST_FAILED;
  } finally {
    button.disabled = false;
  }
});
