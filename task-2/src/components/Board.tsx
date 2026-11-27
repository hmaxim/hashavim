"use client";

import { useState } from "react";
import type { Snapshot } from "@/src/lib/types";
import { useEventStream } from "@/src/hooks/useEventStream";
import { BoardStoreProvider } from "@/src/state/store";
import { ActivityLog } from "./ActivityLog";
import { AssigneeView } from "./AssigneeView";
import { ConnectionStatus } from "./ConnectionStatus";
import { MockControls } from "./MockControls";
import { SummaryPanel } from "./SummaryPanel";
import { TaskEditor } from "./TaskEditor";
import { TaskList } from "./TaskList";
import styles from "./board.module.css";

function BoardInner() {
  const [error, setError] = useState<string | null>(null);
  useEventStream();

  return (
    <div className={styles.board}>
      <header className={styles.header}>
        <div>
          <h1>Team task board</h1>
          <p className={styles.muted}>
            One shared store — every panel stays in sync.
          </p>
        </div>
        <div className={styles.headerActions}>
          <ConnectionStatus />
          <MockControls />
        </div>
      </header>
      {error ? (
        <p className={styles.errorBanner} role="alert">
          {error}
        </p>
      ) : null}
      <div className={styles.grid}>
        <TaskList onError={setError} />
        <TaskEditor onError={setError} />
        <SummaryPanel />
        <AssigneeView />
        <ActivityLog />
      </div>
    </div>
  );
}

export function Board({ initialSnapshot }: { initialSnapshot: Snapshot }) {
  return (
    <BoardStoreProvider initialSnapshot={initialSnapshot}>
      <BoardInner />
    </BoardStoreProvider>
  );
}
