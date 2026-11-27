import type {
  ActivityEntry,
  BoardState,
  ConnectionStatus,
  PendingMutation,
  Snapshot,
  Task,
  TaskEvent,
  TaskPatch,
} from "@/src/lib/types";
import { ACTIVITY_CLIENT_LIMIT } from "@/src/lib/types";

export type BoardEvent =
  | { type: "snapshot"; snapshot: Snapshot }
  | { type: "server"; event: TaskEvent }
  | {
      type: "optimistic.create";
      task: Task;
      mutationId: string;
      activity: ActivityEntry;
    }
  | {
      type: "optimistic.update";
      taskId: string;
      patch: TaskPatch;
      mutationId: string;
      activity: ActivityEntry;
      previous: TaskPatch;
    }
  | {
      type: "optimistic.delete";
      taskId: string;
      mutationId: string;
      activity: ActivityEntry;
      taskSnapshot: Task;
    }
  | { type: "rollback"; mutationId: string }
  | { type: "markFailed"; mutationId: string }
  | { type: "select"; taskId: string | null }
  | { type: "connection"; status: ConnectionStatus }
  | { type: "clearNeedsResync" }
  /** Local-only delete when the server already removed the task (404). */
  | { type: "ensureDeleted"; taskId: string };

export function emptyBoardState(): BoardState {
  return {
    tasksById: {},
    order: [],
    selectedId: null,
    activity: [],
    pendingMutations: {},
    lastSeq: 0,
    connection: "disconnected",
    needsResync: false,
  };
}

export function stateFromSnapshot(snapshot: Snapshot): BoardState {
  const tasksById: Record<string, Task> = {};
  const order: string[] = [];
  for (const task of snapshot.tasks) {
    tasksById[task.id] = task;
    order.push(task.id);
  }
  return {
    ...emptyBoardState(),
    tasksById,
    order,
    activity: snapshot.activity.slice(0, ACTIVITY_CLIENT_LIMIT),
    lastSeq: snapshot.seq,
    connection: "connected",
    needsResync: false,
  };
}

function prependActivity(
  activity: ActivityEntry[],
  entry: ActivityEntry,
): ActivityEntry[] {
  return [entry, ...activity].slice(0, ACTIVITY_CLIENT_LIMIT);
}

function replacePendingActivity(
  activity: ActivityEntry[],
  mutationId: string,
  entry: ActivityEntry,
): ActivityEntry[] {
  const without = activity.filter((a) => a.mutationId !== mutationId);
  return prependActivity(without, entry);
}

function applyTaskCreated(state: BoardState, task: Task): BoardState {
  if (state.tasksById[task.id]) {
    return {
      ...state,
      tasksById: { ...state.tasksById, [task.id]: task },
    };
  }
  return {
    ...state,
    tasksById: { ...state.tasksById, [task.id]: task },
    order: [...state.order, task.id],
  };
}

function applyTaskUpdated(state: BoardState, task: Task): BoardState {
  if (!state.tasksById[task.id]) {
    return applyTaskCreated(state, task);
  }
  return {
    ...state,
    tasksById: { ...state.tasksById, [task.id]: task },
  };
}

function applyTaskDeleted(state: BoardState, taskId: string): BoardState {
  if (!state.tasksById[taskId]) {
    return {
      ...state,
      selectedId: state.selectedId === taskId ? null : state.selectedId,
    };
  }
  const { [taskId]: _, ...rest } = state.tasksById;
  void _;
  return {
    ...state,
    tasksById: rest,
    order: state.order.filter((id) => id !== taskId),
    selectedId: state.selectedId === taskId ? null : state.selectedId,
  };
}

function removePending(
  pending: Record<string, PendingMutation>,
  mutationId: string,
): Record<string, PendingMutation> {
  const { [mutationId]: _, ...rest } = pending;
  void _;
  return rest;
}

function reapplyPending(base: BoardState): BoardState {
  let next = base;
  for (const mutation of Object.values(base.pendingMutations)) {
    if (mutation.kind === "create" && mutation.taskSnapshot) {
      next = applyTaskCreated(next, mutation.taskSnapshot);
    } else if (mutation.kind === "update" && mutation.optimistic) {
      const current = next.tasksById[mutation.taskId];
      if (current) {
        next = {
          ...next,
          tasksById: {
            ...next.tasksById,
            [mutation.taskId]: {
              ...current,
              ...mutation.optimistic,
            },
          },
        };
      }
    } else if (mutation.kind === "delete") {
      next = applyTaskDeleted(next, mutation.taskId);
    }
  }
  return {
    ...next,
    pendingMutations: base.pendingMutations,
    activity: base.activity,
  };
}

function applyServerEvent(state: BoardState, event: TaskEvent): BoardState {
  if (event.seq <= state.lastSeq) {
    return state;
  }
  if (event.seq > state.lastSeq + 1) {
    return { ...state, needsResync: true, connection: "reconnecting" };
  }

  const mutationId = event.mutationId;
  const isEcho = Boolean(
    mutationId && state.pendingMutations[mutationId],
  );

  let next = state;

  if (event.type === "task.created" && event.task) {
    next = applyTaskCreated(next, event.task);
  } else if (event.type === "task.updated" && event.task) {
    next = applyTaskUpdated(next, event.task);
  } else if (event.type === "task.deleted") {
    next = applyTaskDeleted(next, event.taskId);
  }

  if (isEcho && mutationId) {
    next = {
      ...next,
      pendingMutations: removePending(next.pendingMutations, mutationId),
      activity: replacePendingActivity(next.activity, mutationId, {
        ...event.activity,
        pending: false,
        failed: false,
      }),
      lastSeq: event.seq,
      needsResync: false,
    };
    return next;
  }

  return {
    ...next,
    activity: prependActivity(next.activity, event.activity),
    lastSeq: event.seq,
    needsResync: false,
  };
}

function applyRollback(state: BoardState, mutationId: string): BoardState {
  const mutation = state.pendingMutations[mutationId];
  if (!mutation) return state;

  let next = state;

  if (mutation.kind === "create") {
    next = applyTaskDeleted(next, mutation.taskId);
  } else if (mutation.kind === "delete" && mutation.taskSnapshot) {
    next = applyTaskCreated(next, mutation.taskSnapshot);
    // Preserve original order position if possible: append is fine for rollback.
  } else if (mutation.kind === "update" && mutation.optimistic && mutation.previous) {
    const current = next.tasksById[mutation.taskId];
    if (current) {
      const restored: Task = { ...current };
      for (const key of Object.keys(mutation.optimistic) as (keyof TaskPatch)[]) {
        if (mutation.optimistic[key] === current[key]) {
          const prev = mutation.previous[key];
          if (prev !== undefined) {
            (restored as Record<string, unknown>)[key] = prev;
          }
        }
      }
      next = {
        ...next,
        tasksById: { ...next.tasksById, [mutation.taskId]: restored },
      };
    }
  }

  return {
    ...next,
    pendingMutations: removePending(next.pendingMutations, mutationId),
    activity: next.activity.filter((a) => a.mutationId !== mutationId),
  };
}

/**
 * Single path for every board change: snapshots, server events, optimistic
 * mutations, rollbacks, and UI-only selection/connection updates.
 */
export function applyEvent(state: BoardState, event: BoardEvent): BoardState {
  switch (event.type) {
    case "snapshot": {
      const base = stateFromSnapshot(event.snapshot);
      const withPending = reapplyPending({
        ...base,
        pendingMutations: state.pendingMutations,
        activity: [
          ...state.activity.filter((a) => a.pending),
          ...base.activity.filter(
            (a) =>
              !a.mutationId ||
              !state.pendingMutations[a.mutationId],
          ),
        ].slice(0, ACTIVITY_CLIENT_LIMIT),
        selectedId: state.selectedId,
        connection: "connected",
        needsResync: false,
      });
      // Keep selection only if the task still exists after resync.
      if (
        withPending.selectedId &&
        !withPending.tasksById[withPending.selectedId]
      ) {
        return { ...withPending, selectedId: null };
      }
      return withPending;
    }
    case "server":
      return applyServerEvent(state, event.event);
    case "optimistic.create": {
      const pending: PendingMutation = {
        mutationId: event.mutationId,
        kind: "create",
        taskId: event.task.id,
        taskSnapshot: event.task,
      };
      return {
        ...applyTaskCreated(state, event.task),
        pendingMutations: {
          ...state.pendingMutations,
          [event.mutationId]: pending,
        },
        activity: prependActivity(state.activity, {
          ...event.activity,
          pending: true,
        }),
      };
    }
    case "optimistic.update": {
      const current = state.tasksById[event.taskId];
      if (!current) return state;
      const pending: PendingMutation = {
        mutationId: event.mutationId,
        kind: "update",
        taskId: event.taskId,
        previous: event.previous,
        optimistic: event.patch,
      };
      return {
        ...state,
        tasksById: {
          ...state.tasksById,
          [event.taskId]: {
            ...current,
            ...event.patch,
            updatedAt: event.activity.at,
          },
        },
        pendingMutations: {
          ...state.pendingMutations,
          [event.mutationId]: pending,
        },
        activity: prependActivity(state.activity, {
          ...event.activity,
          pending: true,
        }),
      };
    }
    case "optimistic.delete": {
      const pending: PendingMutation = {
        mutationId: event.mutationId,
        kind: "delete",
        taskId: event.taskId,
        taskSnapshot: event.taskSnapshot,
      };
      return {
        ...applyTaskDeleted(state, event.taskId),
        pendingMutations: {
          ...state.pendingMutations,
          [event.mutationId]: pending,
        },
        activity: prependActivity(state.activity, {
          ...event.activity,
          pending: true,
        }),
      };
    }
    case "rollback":
      return applyRollback(state, event.mutationId);
    case "markFailed": {
      // Roll back optimistic fields, then keep the log row marked failed.
      const rolled = applyRollback(state, event.mutationId);
      const failedEntry = state.activity.find(
        (a) => a.mutationId === event.mutationId,
      );
      if (!failedEntry) return rolled;
      return {
        ...rolled,
        activity: prependActivity(rolled.activity, {
          ...failedEntry,
          pending: false,
          failed: true,
        }),
      };
    }
    case "select":
      return { ...state, selectedId: event.taskId };
    case "connection":
      return { ...state, connection: event.status };
    case "clearNeedsResync":
      return { ...state, needsResync: false };
    case "ensureDeleted":
      return applyTaskDeleted(state, event.taskId);
    default: {
      const _exhaustive: never = event;
      return _exhaustive;
    }
  }
}
