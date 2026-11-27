"use client";

import { memo, useState } from "react";
import styles from "./board.module.css";

export const MockControls = memo(function MockControls() {
  const [paused, setPaused] = useState(false);

  return (
    <div className={styles.mockControls}>
      <button
        type="button"
        onClick={async () => {
          await fetch("/api/mock/tick", { method: "POST" });
        }}
      >
        Tick mock update
      </button>
      <button
        type="button"
        onClick={async () => {
          const action = paused ? "resume" : "pause";
          const res = await fetch(`/api/mock/tick?action=${action}`, {
            method: "POST",
          });
          const body = (await res.json()) as { paused: boolean };
          setPaused(body.paused);
        }}
      >
        {paused ? "Resume server updates" : "Pause server updates"}
      </button>
    </div>
  );
});
