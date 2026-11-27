"use client";

import { memo } from "react";
import { useBoardStore } from "@/src/state/store";
import styles from "./board.module.css";

export const ConnectionStatus = memo(function ConnectionStatus() {
  const connection = useBoardStore((s) => s.connection);
  const label =
    connection === "connected"
      ? "Connected"
      : connection === "reconnecting"
        ? "Reconnecting…"
        : "Disconnected";

  return (
    <div
      className={styles.connection}
      data-status={connection}
      role="status"
      aria-live="polite"
    >
      <span className={styles.connectionDot} aria-hidden />
      {label}
    </div>
  );
});
