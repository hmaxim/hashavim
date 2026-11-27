import { createId } from "@/src/lib/ids";
import type {
  ActivityEntry,
  Snapshot,
  Task,
  TaskEvent,
  TaskPatch,
} from "@/src/lib/types";
import { createSeedTasks } from "./seed";

const ACTIVITY_LIMIT = 50;

export type ServerListener = (event: TaskEvent) => void;

export type CreateTaskParams = {
  id: string;
  title: string;
  assigneeId: string | null;
  status: Task["status"];
  priority: Task["priority"];
  mutationId?: string;
  source?: "user" | "server";
  now?: string;
};

export type PatchResult =
  | { ok: true; noop: true }
  | { ok: true; noop: false; event: TaskEvent; task: Task }
  | { ok: false; status: 404 };

export type CreateResult =
  | { ok: true; task: Task; event: TaskEvent }
  | { ok: false; status: 409; error: string };

export type DeleteResult =
  | { ok: true; event: TaskEvent }
  | { ok: false; status: 404 };

export type ServerStore = {
  getSnapshot: () => Snapshot;
  createTask: (params: CreateTaskParams) => CreateResult;
  patchTask: (
    id: string,
    patch: TaskPatch,
    opts?: { mutationId?: string; source?: "user" | "server"; now?: string },
  ) => PatchResult;
  deleteTask: (
    id: string,
    opts?: { mutationId?: string; source?: "user" | "server"; now?: string },
  ) => DeleteResult;
  subscribe: (listener: ServerListener) => () => void;
  getSeq: () => number;
};

function buildChanges(task: Task, patch: TaskPatch) {
  const changes: ActivityEntry["changes"] = [];
  for (const key of Object.keys(patch) as (keyof TaskPatch)[]) {
    const next = patch[key];
    if (next !== undefined && task[key] !== next) {
      changes.push({ field: key, from: task[key], to: next });
    }
  }
  return changes;
}

export function createServerStore(initialTasks?: Task[]): ServerStore {
  const tasksById: Record<string, Task> = {};
  let order: string[] = [];
  let activity: ActivityEntry[] = [];
  let seq = 0;
  const listeners = new Set<ServerListener>();

  for (const task of initialTasks ?? createSeedTasks()) {
    tasksById[task.id] = task;
    order.push(task.id);
  }

  function notify(event: TaskEvent) {
    for (const listener of listeners) {
      listener(event);
    }
  }

  function pushActivity(entry: ActivityEntry) {
    activity = [entry, ...activity].slice(0, ACTIVITY_LIMIT);
  }

  return {
    getSnapshot() {
      return {
        tasks: order.map((id) => tasksById[id]).filter(Boolean) as Task[],
        activity: [...activity],
        seq,
      };
    },
    getSeq() {
      return seq;
    },
    createTask(params) {
      if (tasksById[params.id]) {
        return { ok: false, status: 409, error: "Task id already exists" };
      }
      const now = params.now ?? new Date().toISOString();
      const task: Task = {
        id: params.id,
        title: params.title,
        assigneeId: params.assigneeId,
        status: params.status,
        priority: params.priority,
        createdAt: now,
        updatedAt: now,
      };
      tasksById[task.id] = task;
      order.push(task.id);
      seq += 1;
      const entry: ActivityEntry = {
        id: createId(),
        at: now,
        source: params.source ?? "user",
        type: "created",
        taskId: task.id,
        taskTitle: task.title,
        changes: [],
        mutationId: params.mutationId,
      };
      pushActivity(entry);
      const event: TaskEvent = {
        seq,
        type: "task.created",
        task,
        taskId: task.id,
        mutationId: params.mutationId,
        activity: entry,
      };
      notify(event);
      return { ok: true, task, event };
    },
    patchTask(id, patch, opts) {
      const current = tasksById[id];
      if (!current) return { ok: false, status: 404 };
      const changes = buildChanges(current, patch);
      if (changes.length === 0) {
        return { ok: true, noop: true };
      }
      const now = opts?.now ?? new Date().toISOString();
      const task: Task = {
        ...current,
        ...patch,
        updatedAt: now,
      };
      tasksById[id] = task;
      seq += 1;
      const entry: ActivityEntry = {
        id: createId(),
        at: now,
        source: opts?.source ?? "user",
        type: "updated",
        taskId: id,
        taskTitle: task.title,
        changes,
        mutationId: opts?.mutationId,
      };
      pushActivity(entry);
      const event: TaskEvent = {
        seq,
        type: "task.updated",
        task,
        taskId: id,
        mutationId: opts?.mutationId,
        activity: entry,
      };
      notify(event);
      return { ok: true, noop: false, event, task };
    },
    deleteTask(id, opts) {
      const current = tasksById[id];
      if (!current) return { ok: false, status: 404 };
      const now = opts?.now ?? new Date().toISOString();
      delete tasksById[id];
      order = order.filter((x) => x !== id);
      seq += 1;
      const entry: ActivityEntry = {
        id: createId(),
        at: now,
        source: opts?.source ?? "user",
        type: "deleted",
        taskId: id,
        taskTitle: current.title,
        changes: [],
        mutationId: opts?.mutationId,
      };
      pushActivity(entry);
      const event: TaskEvent = {
        seq,
        type: "task.deleted",
        taskId: id,
        mutationId: opts?.mutationId,
        activity: entry,
      };
      notify(event);
      return { ok: true, event };
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

type GlobalBoard = {
  store: ServerStore;
  mockStarted: boolean;
  mockPaused: boolean;
};

const GLOBAL_KEY = "__taskBoardServer__";

export function getServerStore(): ServerStore {
  const g = globalThis as typeof globalThis & {
    [GLOBAL_KEY]?: GlobalBoard;
  };
  if (!g[GLOBAL_KEY]) {
    g[GLOBAL_KEY] = {
      store: createServerStore(),
      mockStarted: false,
      mockPaused: false,
    };
  }
  return g[GLOBAL_KEY].store;
}

export function getMockControl(): {
  mockStarted: boolean;
  mockPaused: boolean;
  setStarted: (v: boolean) => void;
  setPaused: (v: boolean) => void;
} {
  const g = globalThis as typeof globalThis & {
    [GLOBAL_KEY]?: GlobalBoard;
  };
  if (!g[GLOBAL_KEY]) {
    getServerStore();
  }
  const board = g[GLOBAL_KEY]!;
  return {
    get mockStarted() {
      return board.mockStarted;
    },
    get mockPaused() {
      return board.mockPaused;
    },
    setStarted(v) {
      board.mockStarted = v;
    },
    setPaused(v) {
      board.mockPaused = v;
    },
  };
}
