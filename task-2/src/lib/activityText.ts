import { memberName } from "./members";
import type { ActivityEntry } from "./types";

function formatValue(field: string, value: unknown): string {
  if (field === "assigneeId") {
    return memberName(value as string | null);
  }
  if (value === null || value === undefined) return "none";
  return String(value).replace(/_/g, " ");
}

export function formatActivity(entry: ActivityEntry): string {
  const who = entry.source === "user" ? "You" : "Server";
  const title = entry.taskTitle;

  if (entry.type === "created") {
    return `${who} created '${title}'`;
  }
  if (entry.type === "deleted") {
    return `${who} deleted '${title}'`;
  }

  if (entry.changes.length === 0) {
    return `${who} updated '${title}'`;
  }

  const parts = entry.changes.map((change) => {
    if (change.field === "assigneeId") {
      const to = formatValue("assigneeId", change.to);
      if (change.to === null) {
        return `unassigned '${title}'`;
      }
      if (entry.source === "server") {
        return `assigned '${title}' to ${to}`;
      }
      return `changed assignee of '${title}' from ${formatValue("assigneeId", change.from)} to ${to}`;
    }
    return `changed ${change.field} of '${title}' from ${formatValue(change.field, change.from)} to ${formatValue(change.field, change.to)}`;
  });

  if (parts.length === 1 && entry.source === "server" && entry.changes[0]?.field === "assigneeId") {
    return `Server ${parts[0]}`;
  }

  return `${who} ${parts.join("; ")}`;
}
