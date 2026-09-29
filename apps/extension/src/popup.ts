import "./popup.css";
import type { CourseObservation } from "@btu-course-watch/contracts";
import {
  INSPECT_REQUEST,
  type InspectionError,
  type InspectionResult,
} from "./protocol.js";

const status = document.querySelector<HTMLParagraphElement>("#status");
const button = document.querySelector<HTMLButtonElement>("#inspect");
const results = document.querySelector<HTMLElement>("#results");
const summary = document.querySelector<HTMLParagraphElement>("#summary");
const groups = document.querySelector<HTMLUListElement>("#groups");

if (!status || !button || !results || !summary || !groups) {
  throw new Error("Popup elements are missing.");
}

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
    })) as InspectionResult | undefined;
    if (!response || typeof response !== "object") {
      status.textContent = errorMessages.REQUEST_FAILED;
    } else if (response.ok) {
      renderObservation(response.observation);
      status.textContent =
        "Inspection complete. Results stayed in this browser.";
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
