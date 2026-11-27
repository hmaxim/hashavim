"use client";

import { createId } from "@/src/lib/ids";
import { validateTitle } from "@/src/lib/validation";
import type {
  ActivityChange,
  Priority,
  Status,
  Task,
  TaskPatch,
} from "@/src/lib/types";
import type { BoardStoreApi } from "./store";

export type ActionError = { message: string } | null;

function nowIso(): string {
  return new Date().toISOString();
}

function patchChanges(task: Task, patch: TaskPatch): ActivityChange[] {
  const changes: ActivityChange[] = [];
  for (const key of Object.keys(patch) as (keyof TaskPatch)[]) {
    const next = patch[key];
    if (next !== undefined && task[key] !== next) {
      changes.push({ field: key, from: task[key], to: next });
    }
  }
  return changes;
}

async function parseError(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as { error?: string };
    return body.error ?? res.statusText;
  } catch {
    return res.statusText || `Request failed (${res.status})`;
  }
}

export async function addTask(
  store: BoardStoreApi,
  input: {
    title: string;
    assigneeId?: string | null;
    status?: Status;
    priority?: Priority;
  },
): Promise<ActionError> {
  const titleResult = validateTitle(input.title);
  if (!titleResult.ok) return { message: titleResult.error };

  const at = nowIso();
  const task: Task = {
    id: createId(),
    title: titleResult.title,
    assigneeId: input.assigneeId ?? null,
    status: input.status ?? "todo",
    priority: input.priority ?? "medium",
    createdAt: at,
    updatedAt: at,
  };
  const mutationId = createId();

  store.getState().dispatch({
    type: "optimistic.create",
    task,
    mutationId,
    activity: {
      id: createId(),
      at,
      source: "user",
      type: "created",
      taskId: task.id,
      taskTitle: task.title,
      changes: [],
      mutationId,
      pending: true,
    },
  });

  try {
    const res = await fetch("/api/tasks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: task.id,
        title: task.title,
        assigneeId: task.assigneeId,
        status: task.status,
        priority: task.priority,
        mutationId,
      }),
    });
    if (!res.ok) {
      store.getState().dispatch({ type: "markFailed", mutationId });
      return { message: await parseError(res) };
    }
    return null;
  } catch {
    store.getState().dispatch({ type: "markFailed", mutationId });
    return { message: "Network error while creating task" };
  }
}

export async function updateTask(
  store: BoardStoreApi,
  taskId: string,
  patch: TaskPatch,
): Promise<ActionError> {
  const task = store.getState().tasksById[taskId];
  if (!task) return { message: "Task not found" };

  let nextPatch = patch;
  if ("title" in nextPatch && nextPatch.title !== undefined) {
    const titleResult = validateTitle(nextPatch.title);
    if (!titleResult.ok) return { message: titleResult.error };
    nextPatch = { ...nextPatch, title: titleResult.title };
  }

  const changes = patchChanges(task, nextPatch);
  if (changes.length === 0) return null;

  const previous: TaskPatch = {};
  const optimistic: TaskPatch = {};
  for (const change of changes) {
    const field = change.field as keyof TaskPatch;
    previous[field] = change.from as never;
    optimistic[field] = change.to as never;
  }

  const mutationId = createId();
  const at = nowIso();

  store.getState().dispatch({
    type: "optimistic.update",
    taskId,
    patch: optimistic,
    previous,
    mutationId,
    activity: {
      id: createId(),
      at,
      source: "user",
      type: "updated",
      taskId,
      taskTitle:
        typeof optimistic.title === "string" ? optimistic.title : task.title,
      changes,
      mutationId,
      pending: true,
    },
  });

  try {
    const res = await fetch(`/api/tasks/${taskId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ patch: optimistic, mutationId }),
    });
    if (res.status === 404) {
      store.getState().dispatch({ type: "rollback", mutationId });
      store.getState().dispatch({ type: "ensureDeleted", taskId });
      return null;
    }
    if (!res.ok) {
      store.getState().dispatch({ type: "markFailed", mutationId });
      return { message: await parseError(res) };
    }
    return null;
  } catch {
    store.getState().dispatch({ type: "markFailed", mutationId });
    return { message: "Network error while updating task" };
  }
}

export async function deleteTask(
  store: BoardStoreApi,
  taskId: string,
): Promise<ActionError> {
  const task = store.getState().tasksById[taskId];
  if (!task) return null;

  const mutationId = createId();
  const at = nowIso();

  store.getState().dispatch({
    type: "optimistic.delete",
    taskId,
    mutationId,
    taskSnapshot: task,
    activity: {
      id: createId(),
      at,
      source: "user",
      type: "deleted",
      taskId,
      taskTitle: task.title,
      changes: [],
      mutationId,
      pending: true,
    },
  });

  try {
    const res = await fetch(
      `/api/tasks/${taskId}?mutationId=${encodeURIComponent(mutationId)}`,
      { method: "DELETE" },
    );
    if (res.status === 404) {
      store.getState().dispatch({ type: "rollback", mutationId });
      store.getState().dispatch({ type: "ensureDeleted", taskId });
      return null;
    }
    if (!res.ok) {
      store.getState().dispatch({ type: "markFailed", mutationId });
      return { message: await parseError(res) };
    }
    return null;
  } catch {
    store.getState().dispatch({ type: "markFailed", mutationId });
    return { message: "Network error while deleting task" };
  }
}

export function selectTask(store: BoardStoreApi, taskId: string | null): void {
  store.getState().dispatch({ type: "select", taskId });
}
