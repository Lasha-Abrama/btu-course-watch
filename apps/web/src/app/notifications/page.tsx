"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import type {
  AvailabilityNotification,
  NotificationListResponse,
} from "@btu-course-watch/contracts";
import { RequireAuth, useAuthSession } from "../../components/auth-session";
import { AuthShell, Notice } from "../../components/auth-ui";
import {
  ApiError,
  listNotifications,
  markAllNotificationsRead,
  markNotificationRead,
} from "../../lib/auth-api";

export default function NotificationsPage() {
  const { user, recheck } = useAuthSession();
  const [page, setPage] = useState<NotificationListResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleError = useCallback(
    async (cause: unknown, message: string) => {
      if (cause instanceof ApiError && cause.status === 401) await recheck();
      setError(message);
    },
    [recheck],
  );

  const load = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    setError(null);
    try {
      setPage(await listNotifications());
    } catch (cause) {
      await handleError(cause, "Could not load your alerts. Please try again.");
    } finally {
      setLoading(false);
    }
  }, [user, handleError]);

  useEffect(() => {
    void load();
  }, [load]);

  async function loadMore() {
    if (!page?.nextCursor) return;
    setBusy(true);
    setError(null);
    try {
      const next = await listNotifications(page.nextCursor);
      setPage({ ...next, items: [...page.items, ...next.items] });
    } catch (cause) {
      await handleError(cause, "Could not load more alerts. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  async function markOne(item: AvailabilityNotification) {
    setBusy(true);
    setError(null);
    try {
      await markNotificationRead(item.id);
      setPage((previous) =>
        previous
          ? {
              ...previous,
              unreadCount: Math.max(0, previous.unreadCount - 1),
              items: previous.items.map((entry) =>
                entry.id === item.id
                  ? { ...entry, readAt: new Date().toISOString() }
                  : entry,
              ),
            }
          : previous,
      );
    } catch (cause) {
      await handleError(cause, "Could not mark this alert as read.");
    } finally {
      setBusy(false);
    }
  }

  async function markAll() {
    setBusy(true);
    setError(null);
    try {
      await markAllNotificationsRead();
      const readAt = new Date().toISOString();
      setPage((previous) =>
        previous
          ? {
              ...previous,
              unreadCount: 0,
              items: previous.items.map((item) => ({ ...item, readAt })),
            }
          : previous,
      );
    } catch (cause) {
      await handleError(cause, "Could not mark all alerts as read.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthShell
      eyebrow="YOUR AVAILABILITY HISTORY"
      title="Availability alerts"
      description="Saved alerts for groups you watched when an observation detected they became available. These are historical events, not live availability or enrollment."
      footer={<Link href="/watches">View watched groups</Link>}
    >
      <RequireAuth>
        {loading && <p role="status">Loading availability alerts…</p>}
        {error && (
          <Notice kind="error">
            {error}{" "}
            <button type="button" onClick={() => void load()}>
              Try again
            </button>
          </Notice>
        )}
        {!loading && page && (
          <>
            <div className="extension-panel">
              <p>{page.unreadCount} unread alerts</p>
              {page.unreadCount > 0 && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void markAll()}
                >
                  Mark all read
                </button>
              )}
            </div>
            {page.items.length === 0 ? (
              <p>
                No availability alerts yet. A watch records your interest; an
                alert appears only after an observed transition into AVAILABLE.
              </p>
            ) : (
              <ul className="watch-list">
                {page.items.map((item) => (
                  <li
                    key={item.id}
                    className={item.readAt ? undefined : "notification-unread"}
                  >
                    <div>
                      <strong>
                        {item.readAt ? "Read" : "Unread"} ·{" "}
                        {item.groupName ?? `Group ${item.btuGroupId}`} became
                        available
                      </strong>
                      <span>
                        {item.courseName ?? `Course ${item.btuCourseId}`} ·
                        Course ID {item.btuCourseId} · Group ID{" "}
                        {item.btuGroupId}
                      </span>
                      <span>
                        Observed {new Date(item.observedAt).toLocaleString()}
                      </span>
                    </div>
                    {!item.readAt && (
                      <button
                        type="button"
                        className="text-button"
                        disabled={busy}
                        onClick={() => void markOne(item)}
                      >
                        Mark read
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            )}
            {page.nextCursor && (
              <button
                type="button"
                disabled={busy}
                onClick={() => void loadMore()}
              >
                {busy ? "Loading…" : "Load more"}
              </button>
            )}
          </>
        )}
      </RequireAuth>
    </AuthShell>
  );
}
