import { describe, expect, it } from "vitest";
import { formatActivity } from "./activityText";
import type { ActivityEntry } from "./types";

const base: ActivityEntry = {
  id: "a1",
  at: "2026-01-01T00:00:00.000Z",
  source: "user",
  type: "created",
  taskId: "t1",
  taskTitle: "Alpha",
  changes: [],
};

describe("formatActivity", () => {
  it("says 'You' only for this tab's own changes", () => {
    expect(formatActivity({ ...base, own: true })).toBe("You created 'Alpha'");
    expect(formatActivity(base)).toBe("A user created 'Alpha'");
    expect(formatActivity({ ...base, source: "server" })).toBe(
      "Server created 'Alpha'",
    );
  });
});
