import { inspectGroupsPage } from "./inspection.js";
import { linkStatus, startLink, submitObservation } from "./account.js";
import {
  INSPECT_REQUEST,
  LINK_START,
  LINK_STATUS,
  isPopupRequest,
} from "./protocol.js";

const storageReady = chrome.storage.local.setAccessLevel({
  accessLevel: "TRUSTED_CONTEXTS",
});

chrome.runtime.onMessage.addListener(
  (message: unknown, sender, sendResponse) => {
    if (
      !isPopupRequest(message) ||
      sender.id !== chrome.runtime.id ||
      sender.url !== chrome.runtime.getURL("popup.html")
    ) {
      return;
    }

    if (message.type === LINK_START) {
      void storageReady
        .then(() => startLink())
        .then(async (link) => {
          await chrome.tabs.create({ url: link.url });
          return {
            ok: true,
            link: {
              state: "PENDING",
              pairingCode: link.pairingCode,
              expiresAt: link.expiresAt,
            },
          };
        })
        .then(sendResponse)
        .catch(() => sendResponse({ ok: false, error: "LINK_FAILED" }));
    } else if (message.type === LINK_STATUS) {
      void storageReady
        .then(() => linkStatus())
        .then((link) => sendResponse({ ok: true, link }))
        .catch(() => sendResponse({ ok: false, error: "LINK_FAILED" }));
    } else if (message.type === INSPECT_REQUEST) {
      void chrome.tabs
        .query({ active: true, lastFocusedWindow: true })
        .then(([tab]) => inspectGroupsPage(tab?.url))
        .then(async (result) => {
          if (!result.ok) return result;
          try {
            await storageReady;
            return {
              ...result,
              submission: await submitObservation(result.observation),
            };
          } catch {
            return {
              ...result,
              submission: { state: "SUBMISSION_FAILED" as const },
            };
          }
        })
        .then(sendResponse)
        .catch(() => sendResponse({ ok: false, error: "REQUEST_FAILED" }));
    }
    return true;
  },
);
