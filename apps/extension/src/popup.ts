import "./popup.css";
import type { CourseObservation } from "@btu-course-watch/contracts";
import {
  INSPECT_REQUEST,
  LINK_START,
  LINK_STATUS,
  type LinkResult,
  type InspectionError,
  type InspectionSubmissionResult,
} from "./protocol.js";

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

if (
  !status ||
  !button ||
  !results ||
  !summary ||
  !groups ||
  !linkStatusText ||
  !linkButton ||
  !checkLinkButton
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

const errorMessages: Record<InspectionError, string> = {
  NOT_CLASSROOM: "Open BTU Classroom in the active tab first.",
  UNSUPPORTED_PAGE:
    "Open a subject’s Groups tab, not My Courses or another section.",
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
    details.textContent = `Capacity: ${group.capacity ?? "unknown"} · ${group.status} · Choose action: ${group.chooseUrl ? "present" : "none"}`;
    item.append(title, details);
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
