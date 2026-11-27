import { MEMBERS } from "@/src/lib/members";
import type { ActivityEntry, BoardState, Status, Task } from "@/src/lib/types";
import { STATUSES } from "@/src/lib/types";

function memoizeOnRefs<T>(
  refs: (state: BoardState) => unknown[],
  compute: (state: BoardState) => T,
): (state: BoardState) => T {
  let cachedRefs: unknown[] | null = null;
  let cachedValue: T | null = null;
  return (state: BoardState) => {
    const nextRefs = refs(state);
    if (
      cachedRefs &&
      cachedValue !== null &&
      cachedRefs.length === nextRefs.length &&
      cachedRefs.every((ref, i) => ref === nextRefs[i])
    ) {
      return cachedValue;
    }
    const value = compute(state);
    cachedRefs = nextRefs;
    cachedValue = value;
    return value;
  };
}

export const selectCountsByStatus = memoizeOnRefs(
  (s) => [s.tasksById],
  (state) => {
    const counts = Object.fromEntries(STATUSES.map((s) => [s, 0])) as Record<
      Status,
      number
    >;
    for (const task of Object.values(state.tasksById)) {
      counts[task.status] += 1;
    }
    return counts;
  },
);

export type AssigneeCount = {
  assigneeId: string | null;
  name: string;
  count: number;
};

export const selectCountsByAssignee = memoizeOnRefs(
  (s) => [s.tasksById],
  (state) => {
    const counts = new Map<string | null, number>();
    counts.set(null, 0);
    for (const member of MEMBERS) {
      counts.set(member.id, 0);
    }
    for (const task of Object.values(state.tasksById)) {
      const key = task.assigneeId;
      if (!counts.has(key)) {
        counts.set(key, 0);
      }
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    const result: AssigneeCount[] = [
      { assigneeId: null, name: "Unassigned", count: counts.get(null) ?? 0 },
      ...MEMBERS.map((m) => ({
        assigneeId: m.id,
        name: m.name,
        count: counts.get(m.id) ?? 0,
      })),
    ];
    for (const [id, count] of counts) {
      if (id !== null && !MEMBERS.some((m) => m.id === id)) {
        result.push({ assigneeId: id, name: "Unknown", count });
      }
    }
    return result;
  },
);

export type AssigneeGroup = {
  assigneeId: string | null;
  name: string;
  tasks: Task[];
};

export const selectGroupedByAssignee = memoizeOnRefs(
  (s) => [s.tasksById],
  (state) => {
    const groups: AssigneeGroup[] = [
      { assigneeId: null, name: "Unassigned", tasks: [] },
      ...MEMBERS.map((m) => ({
        assigneeId: m.id,
        name: m.name,
        tasks: [] as Task[],
      })),
    ];
    const byKey = new Map<string | null, AssigneeGroup>();
    for (const group of groups) {
      byKey.set(group.assigneeId, group);
    }

    for (const task of Object.values(state.tasksById)) {
      let group = byKey.get(task.assigneeId);
      if (!group) {
        group = {
          assigneeId: task.assigneeId,
          name: "Unknown",
          tasks: [],
        };
        byKey.set(task.assigneeId, group);
        groups.push(group);
      }
      group.tasks.push(task);
    }

    for (const group of groups) {
      group.tasks.sort((a, b) => a.title.localeCompare(b.title));
    }
    return groups;
  },
);

export const selectOrderedTasks = memoizeOnRefs(
  (s) => [s.tasksById, s.order],
  (state) =>
    state.order
      .map((id) => state.tasksById[id])
      .filter((task): task is Task => Boolean(task)),
);

export function selectSelectedTask(state: BoardState): Task | null {
  if (!state.selectedId) return null;
  return state.tasksById[state.selectedId] ?? null;
}

export function selectTaskTotal(state: BoardState): number {
  return Object.keys(state.tasksById).length;
}

export const selectRecentActivity = memoizeOnRefs(
  (s) => [s.activity],
  (state): ActivityEntry[] => state.activity.slice(0, 20),
);
