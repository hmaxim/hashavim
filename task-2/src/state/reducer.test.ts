import { describe, expect, it } from "vitest";
import type { Task, TaskEvent } from "@/src/lib/types";
import {
  applyEvent,
  emptyBoardState,
  stateFromSnapshot,
} from "./reducer";
import {
  selectCountsByAssignee,
  selectCountsByStatus,
  selectGroupedByAssignee,
} from "./selectors";

function task(partial: Partial<Task> & Pick<Task, "id" | "title">): Task {
  return {
    assigneeId: null,
    status: "todo",
    priority: "medium",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...partial,
  };
}

function serverEvent(
  partial: Partial<TaskEvent> & Pick<TaskEvent, "seq" | "type" | "taskId">,
): TaskEvent {
  return {
    activity: {
      id: `a-${partial.seq}`,
      at: "2026-01-01T00:00:00.000Z",
      source: "server",
      type:
        partial.type === "task.created"
          ? "created"
          : partial.type === "task.deleted"
            ? "deleted"
            : "updated",
      taskId: partial.taskId,
      taskTitle: partial.task?.title ?? "T",
      changes: [],
      mutationId: partial.mutationId,
    },
    ...partial,
  };
}

describe("applyEvent", () => {
  it("applies created/updated/deleted with a log entry in the same step", () => {
    let state = emptyBoardState();
    const t = task({ id: "t1", title: "One" });
    state = applyEvent(state, {
      type: "server",
      event: serverEvent({
        seq: 1,
        type: "task.created",
        taskId: "t1",
        task: t,
      }),
    });
    expect(state.tasksById.t1?.title).toBe("One");
    expect(state.activity[0]?.type).toBe("created");
    expect(state.lastSeq).toBe(1);

    state = applyEvent(state, {
      type: "server",
      event: serverEvent({
        seq: 2,
        type: "task.updated",
        taskId: "t1",
        task: { ...t, status: "done" },
        activity: {
          id: "a2",
          at: "2026-01-01T00:01:00.000Z",
          source: "user",
          type: "updated",
          taskId: "t1",
          taskTitle: "One",
          changes: [{ field: "status", from: "todo", to: "done" }],
        },
      }),
    });
    expect(state.tasksById.t1?.status).toBe("done");
    expect(state.activity[0]?.changes[0]?.to).toBe("done");

    state = applyEvent(state, {
      type: "server",
      event: serverEvent({
        seq: 3,
        type: "task.deleted",
        taskId: "t1",
      }),
    });
    expect(state.tasksById.t1).toBeUndefined();
    expect(state.activity[0]?.type).toBe("deleted");
  });

  it("drops stale seq and flags gaps", () => {
    let state = stateFromSnapshot({
      tasks: [task({ id: "t1", title: "One" })],
      activity: [],
      seq: 2,
    });
    const before = state;
    state = applyEvent(state, {
      type: "server",
      event: serverEvent({ seq: 2, type: "task.deleted", taskId: "t1" }),
    });
    expect(state).toEqual(before);

    state = applyEvent(state, {
      type: "server",
      event: serverEvent({ seq: 4, type: "task.deleted", taskId: "t1" }),
    });
    expect(state.needsResync).toBe(true);
    expect(state.tasksById.t1).toBeDefined();
  });

  it("reconciles echo without duplicating the log entry", () => {
    let state = stateFromSnapshot({
      tasks: [task({ id: "t1", title: "One" })],
      activity: [],
      seq: 0,
    });
    state = applyEvent(state, {
      type: "optimistic.update",
      taskId: "t1",
      patch: { status: "done" },
      previous: { status: "todo" },
      mutationId: "m1",
      activity: {
        id: "pending",
        at: "2026-01-01T00:00:00.000Z",
        source: "user",
        type: "updated",
        taskId: "t1",
        taskTitle: "One",
        changes: [{ field: "status", from: "todo", to: "done" }],
        mutationId: "m1",
        pending: true,
      },
    });
    expect(state.activity).toHaveLength(1);
    expect(state.activity[0]?.pending).toBe(true);

    state = applyEvent(state, {
      type: "server",
      event: serverEvent({
        seq: 1,
        type: "task.updated",
        taskId: "t1",
        mutationId: "m1",
        task: task({
          id: "t1",
          title: "One",
          status: "done",
          updatedAt: "2026-01-01T00:00:01.000Z",
        }),
        activity: {
          id: "server-a",
          at: "2026-01-01T00:00:01.000Z",
          source: "user",
          type: "updated",
          taskId: "t1",
          taskTitle: "One",
          changes: [{ field: "status", from: "todo", to: "done" }],
          mutationId: "m1",
        },
      }),
    });
    expect(state.pendingMutations.m1).toBeUndefined();
    expect(state.activity).toHaveLength(1);
    expect(state.activity[0]?.id).toBe("server-a");
    expect(state.activity[0]?.pending).toBeFalsy();
  });

  it("rolls back only still-optimistic fields", () => {
    let state = stateFromSnapshot({
      tasks: [task({ id: "t1", title: "One", status: "todo", priority: "low" })],
      activity: [],
      seq: 0,
    });
    state = applyEvent(state, {
      type: "optimistic.update",
      taskId: "t1",
      patch: { status: "done" },
      previous: { status: "todo" },
      mutationId: "m1",
      activity: {
        id: "p",
        at: "2026-01-01T00:00:00.000Z",
        source: "user",
        type: "updated",
        taskId: "t1",
        taskTitle: "One",
        changes: [{ field: "status", from: "todo", to: "done" }],
        mutationId: "m1",
        pending: true,
      },
    });
    // Server (or another mutation) changed priority; status still optimistic.
    state = {
      ...state,
      tasksById: {
        t1: { ...state.tasksById.t1!, priority: "high" },
      },
    };
    state = applyEvent(state, { type: "rollback", mutationId: "m1" });
    expect(state.tasksById.t1?.status).toBe("todo");
    expect(state.tasksById.t1?.priority).toBe("high");
  });

  it("clears selectedId when the selected task is deleted", () => {
    let state = stateFromSnapshot({
      tasks: [task({ id: "t1", title: "One" })],
      activity: [],
      seq: 0,
    });
    state = applyEvent(state, { type: "select", taskId: "t1" });
    state = applyEvent(state, {
      type: "server",
      event: serverEvent({ seq: 1, type: "task.deleted", taskId: "t1" }),
    });
    expect(state.selectedId).toBeNull();
  });

  it("re-applies pending mutations on snapshot", () => {
    let state = emptyBoardState();
    const created = task({ id: "t-new", title: "Local" });
    state = applyEvent(state, {
      type: "optimistic.create",
      task: created,
      mutationId: "m-create",
      activity: {
        id: "p",
        at: "2026-01-01T00:00:00.000Z",
        source: "user",
        type: "created",
        taskId: created.id,
        taskTitle: created.title,
        changes: [],
        mutationId: "m-create",
        pending: true,
      },
    });
    state = applyEvent(state, {
      type: "snapshot",
      snapshot: { tasks: [task({ id: "t1", title: "Seed" })], activity: [], seq: 5 },
    });
    expect(state.tasksById["t1"]).toBeDefined();
    expect(state.tasksById["t-new"]).toBeDefined();
    expect(state.lastSeq).toBe(5);
  });
});

describe("selectors", () => {
  it("counts status and assignee including zeros and Unassigned", () => {
    const state = stateFromSnapshot({
      tasks: [
        task({ id: "1", title: "A", status: "todo", assigneeId: null }),
        task({
          id: "2",
          title: "B",
          status: "done",
          assigneeId: "m-alex",
        }),
      ],
      activity: [],
      seq: 0,
    });
    const byStatus = selectCountsByStatus(state);
    expect(byStatus.todo).toBe(1);
    expect(byStatus.done).toBe(1);
    expect(byStatus.in_progress).toBe(0);
    expect(byStatus.in_review).toBe(0);

    const byAssignee = selectCountsByAssignee(state);
    expect(byAssignee.find((r) => r.assigneeId === null)?.count).toBe(1);
    expect(byAssignee.find((r) => r.assigneeId === "m-alex")?.count).toBe(1);
    expect(byAssignee.find((r) => r.assigneeId === "m-ben")?.count).toBe(0);

    const groups = selectGroupedByAssignee(state);
    expect(groups.find((g) => g.assigneeId === null)?.tasks).toHaveLength(1);
    expect(groups.find((g) => g.assigneeId === "m-ben")?.tasks).toHaveLength(0);
  });

  it("holds derived invariants over a random event sequence", () => {
    let seed = 42;
    const rng = () => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed / 0x100000000;
    };

    let state = emptyBoardState();
    const statuses = ["todo", "in_progress", "in_review", "done"] as const;
    const members = [null, "m-alex", "m-ben", "m-cara"] as const;

    for (let i = 1; i <= 80; i++) {
      const ids = Object.keys(state.tasksById);
      const roll = rng();
      if (ids.length === 0 || roll < 0.35) {
        const id = `t-${i}`;
        const t = task({
          id,
          title: `Task ${i}`,
          status: statuses[Math.floor(rng() * statuses.length)]!,
          assigneeId: members[Math.floor(rng() * members.length)]!,
        });
        state = applyEvent(state, {
          type: "server",
          event: serverEvent({
            seq: state.lastSeq + 1,
            type: "task.created",
            taskId: id,
            task: t,
          }),
        });
      } else if (roll < 0.7) {
        const id = ids[Math.floor(rng() * ids.length)]!;
        const current = state.tasksById[id]!;
        const updated = {
          ...current,
          status: statuses[Math.floor(rng() * statuses.length)]!,
          assigneeId: members[Math.floor(rng() * members.length)]!,
        };
        state = applyEvent(state, {
          type: "server",
          event: serverEvent({
            seq: state.lastSeq + 1,
            type: "task.updated",
            taskId: id,
            task: updated,
          }),
        });
      } else {
        const id = ids[Math.floor(rng() * ids.length)]!;
        state = applyEvent(state, {
          type: "server",
          event: serverEvent({
            seq: state.lastSeq + 1,
            type: "task.deleted",
            taskId: id,
          }),
        });
      }
    }

    const tasks = Object.values(state.tasksById);
    const byStatus = selectCountsByStatus(state);
    const byAssignee = selectCountsByAssignee(state);
    const groups = selectGroupedByAssignee(state);

    expect(Object.values(byStatus).reduce((a, b) => a + b, 0)).toBe(tasks.length);
    expect(byAssignee.reduce((a, b) => a + b.count, 0)).toBe(tasks.length);

    const seen = new Set<string>();
    for (const group of groups) {
      for (const t of group.tasks) {
        expect(seen.has(t.id)).toBe(false);
        seen.add(t.id);
      }
    }
    expect(seen.size).toBe(tasks.length);

    // Fresh recompute matches memoized selectors.
    const fresh = stateFromSnapshot({
      tasks,
      activity: [],
      seq: state.lastSeq,
    });
    expect(selectCountsByStatus(fresh)).toEqual(byStatus);
    expect(selectCountsByAssignee(fresh)).toEqual(byAssignee);
  });
});
