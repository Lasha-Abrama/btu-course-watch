"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import type { WatchResponse } from "@btu-course-watch/contracts";
import { RequireAuth, useAuthSession } from "../../components/auth-session";
import { AuthShell, Notice } from "../../components/auth-ui";
import { ApiError, listWatches, removeWatch } from "../../lib/auth-api";

export default function WatchesPage() {
  const { user, recheck } = useAuthSession();
  const [watches, setWatches] = useState<WatchResponse[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    setError(null);
    try {
      setWatches(await listWatches());
    } catch (cause) {
      if (cause instanceof ApiError && cause.status === 401) await recheck();
      setError("Could not load your watches. Please try again.");
    } finally {
      setLoading(false);
    }
  }, [user, recheck]);

  useEffect(() => {
    void load();
  }, [load]);

  async function remove(id: string) {
    setBusyId(id);
    setError(null);
    try {
      await removeWatch(id);
      setWatches((items) => items.filter((item) => item.id !== id));
    } catch (cause) {
      if (cause instanceof ApiError && cause.status === 401) await recheck();
      setError("Could not remove this watch. Please try again.");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <AuthShell
      eyebrow="YOUR COURSE PLANS"
      title="Watched groups"
      description="Groups you chose to track. Availability below is the last observation we received, not a live status or enrollment. Automatic monitoring is not active yet."
      footer={<Link href="/">Back to your account</Link>}
    >
      <RequireAuth>
        {loading && <p role="status">Loading watched groups…</p>}
        {error && (
          <Notice kind="error">
            {error}{" "}
            <button type="button" onClick={() => void load()}>
              Try again
            </button>
          </Notice>
        )}
        {!loading && watches.length === 0 && !error && (
          <div className="extension-panel">
            <p>
              No groups watched yet. Connect Course Watch in the extension,
              inspect a BTU Classroom Groups page, then choose Watch group.
            </p>
            <Link href="/extension-link">Manage extension access</Link>
          </div>
        )}
        {!loading && watches.length > 0 && (
          <ul className="watch-list">
            {watches.map((watch) => (
              <li key={watch.id}>
                <div>
                  <strong>
                    {watch.courseName ?? `Course ${watch.btuCourseId}`}
                  </strong>
                  <span>
                    Course ID {watch.btuCourseId} ·{" "}
                    {watch.groupName ?? `Group ${watch.btuGroupId}`} · Group ID{" "}
                    {watch.btuGroupId}
                  </span>
                  <span>
                    Last-known status: {watch.status} · Capacity:{" "}
                    {watch.capacity ?? "unknown"}
                  </span>
                  <span>
                    Last observed{" "}
                    {new Date(watch.lastObservedAt).toLocaleString()}
                  </span>
                </div>
                <button
                  type="button"
                  className="text-button"
                  disabled={busyId !== null}
                  onClick={() => void remove(watch.id)}
                >
                  {busyId === watch.id ? "Removing…" : "Stop watching"}
                </button>
              </li>
            ))}
          </ul>
        )}
      </RequireAuth>
    </AuthShell>
  );
}
