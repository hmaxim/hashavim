"use client";

import { memo } from "react";
import { STATUSES } from "@/src/lib/types";
import {
  selectCountsByAssignee,
  selectCountsByStatus,
  selectTaskTotal,
} from "@/src/state/selectors";
import { useBoardStore } from "@/src/state/store";
import styles from "./board.module.css";

export const SummaryPanel = memo(function SummaryPanel() {
  const total = useBoardStore(selectTaskTotal);
  const byStatus = useBoardStore(selectCountsByStatus);
  const byAssignee = useBoardStore(selectCountsByAssignee);

  return (
    <section className={styles.panel} aria-labelledby="summary-heading">
      <h2 id="summary-heading">Summary</h2>
      <p className={styles.muted}>Total tasks: {total}</p>
      <h3 className={styles.subheading}>By status</h3>
      <ul className={styles.countList}>
        {STATUSES.map((status) => (
          <li key={status}>
            <span>{status.replace(/_/g, " ")}</span>
            <strong>{byStatus[status]}</strong>
          </li>
        ))}
      </ul>
      <h3 className={styles.subheading}>By assignee</h3>
      <ul className={styles.countList}>
        {byAssignee.map((row) => (
          <li key={row.assigneeId ?? "unassigned"}>
            <span>{row.name}</span>
            <strong>{row.count}</strong>
          </li>
        ))}
      </ul>
      {total === 0 ? (
        <p className={styles.empty}>No tasks yet — counts stay at zero.</p>
      ) : null}
    </section>
  );
});
