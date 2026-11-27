"use client";

import { memo, useEffect, useState } from "react";
import { formatActivity } from "@/src/lib/activityText";
import { selectRecentActivity } from "@/src/state/selectors";
import { useBoardStore } from "@/src/state/store";
import styles from "./board.module.css";

export const ActivityLog = memo(function ActivityLog() {
  const activity = useBoardStore(selectRecentActivity);
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  return (
    <section className={styles.panel} aria-labelledby="activity-heading">
      <h2 id="activity-heading">Activity</h2>
      <ul className={styles.activityList} aria-live="polite">
        {activity.length === 0 ? (
          <li className={styles.empty}>No activity yet.</li>
        ) : (
          activity.map((entry) => (
            <li
              key={entry.id}
              className={
                entry.failed
                  ? styles.activityFailed
                  : entry.pending
                    ? styles.activityPending
                    : undefined
              }
            >
              <span className={styles.activityText}>
                {formatActivity(entry)}
                {entry.pending ? " (pending)" : ""}
                {entry.failed ? " (failed)" : ""}
              </span>
              <time className={styles.activityTime} dateTime={entry.at}>
                {mounted ? new Date(entry.at).toLocaleTimeString() : "—"}
              </time>
            </li>
          ))
        )}
      </ul>
    </section>
  );
});
