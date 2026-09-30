import { inspectGroupsPage } from "./inspection.js";
import {
  linkStatus,
  listWatches,
  startLink,
  submitObservation,
  unwatchGroup,
  watchGroup,
} from "./account.js";
import { completeInspection } from "./inspection-submission.js";
import {
  ensureMonitoringAlarm,
  MONITOR_ALARM,
  readMonitoringHealth,
  runMonitoringCycle,
} from "./monitoring.js";
import {
  INSPECT_REQUEST,
  LINK_START,
  LINK_STATUS,
  MONITOR_STATUS,
  UNWATCH_GROUP,
  WATCH_GROUP,
  isPopupRequest,
} from "./protocol.js";

const storageReady = chrome.storage.local.setAccessLevel({
  accessLevel: "TRUSTED_CONTEXTS",
});

// Reconcile after worker restarts as well as browser/extension lifecycle events.
function reconcileAlarm(): void {
  void storageReady.then(() => ensureMonitoringAlarm()).catch(() => undefined);
}
reconcileAlarm();
chrome.runtime.onInstalled.addListener(reconcileAlarm);
chrome.runtime.onStartup.addListener(reconcileAlarm);

// Best-effort overlap guard; PostgreSQL observation ordering is the authority.
let cycleRunning = false;
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name !== MONITOR_ALARM || cycleRunning) return;
  cycleRunning = true;
  void storageReady
    .then(() => runMonitoringCycle())
    .catch(() => undefined)
    .finally(() => {
      cycleRunning = false;
    });
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
    } else if (message.type === MONITOR_STATUS) {
      void storageReady
        .then(() => readMonitoringHealth())
        .then((health) => sendResponse({ ok: true, health }))
        .catch(() => sendResponse({ ok: false, error: "REQUEST_FAILED" }));
    } else if (message.type === INSPECT_REQUEST) {
      void chrome.tabs
        .query({ active: true, lastFocusedWindow: true })
        .then(([tab]) => inspectGroupsPage(tab?.url))
        .then(async (result) => {
          await storageReady;
          return completeInspection(result, submitObservation, listWatches);
        })
        .then(sendResponse)
        .catch(() => sendResponse({ ok: false, error: "REQUEST_FAILED" }));
    } else if (message.type === WATCH_GROUP || message.type === UNWATCH_GROUP) {
      void storageReady
        .then(() =>
          message.type === WATCH_GROUP
            ? watchGroup(message.group)
            : unwatchGroup(message.watchId),
        )
        .then((watches) => sendResponse({ ok: true, watches }))
        .catch(() => sendResponse({ ok: false, error: "REQUEST_FAILED" }));
    }
    return true;
  },
);
