import { inspectGroupsPage } from "./inspection.js";
import { isInspectRequest } from "./protocol.js";

chrome.runtime.onMessage.addListener(
  (message: unknown, sender, sendResponse) => {
    if (
      !isInspectRequest(message) ||
      sender.id !== chrome.runtime.id ||
      sender.url !== chrome.runtime.getURL("popup.html")
    ) {
      return;
    }

    void chrome.tabs
      .query({ active: true, lastFocusedWindow: true })
      .then(([tab]) => inspectGroupsPage(tab?.url))
      .then(sendResponse)
      .catch(() => sendResponse({ ok: false, error: "REQUEST_FAILED" }));
    return true;
  },
);
