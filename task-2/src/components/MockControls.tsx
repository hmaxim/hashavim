"use client";

import { memo, useEffect, useState } from "react";
import styles from "./board.module.css";

async function mockRequest(
  method: "GET" | "POST",
  query = "",
): Promise<{ paused?: boolean } | null> {
  try {
    const res = await fetch(`/api/mock/tick${query}`, { method });
    return res.ok ? ((await res.json()) as { paused?: boolean }) : null;
  } catch {
    return null;
  }
}

export const MockControls = memo(function MockControls() {
  // Pause lives on the server; null until we know its current value.
  const [paused, setPaused] = useState<boolean | null>(null);

  useEffect(() => {
    void mockRequest("GET").then((body) => {
      if (typeof body?.paused === "boolean") setPaused(body.paused);
    });
  }, []);

  return (
    <div className={styles.mockControls}>
      <button type="button" onClick={() => void mockRequest("POST")}>
        Tick mock update
      </button>
      <button
        type="button"
        disabled={paused === null}
        onClick={async () => {
          const action = paused ? "resume" : "pause";
          const body = await mockRequest("POST", `?action=${action}`);
          if (typeof body?.paused === "boolean") setPaused(body.paused);
        }}
      >
        {paused ? "Resume server updates" : "Pause server updates"}
      </button>
    </div>
  );
});
