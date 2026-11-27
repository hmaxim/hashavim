import { afterEach, describe, expect, it, vi } from "vitest";
import type { Snapshot, Task } from "@/src/lib/types";
import { addTask, deleteTask, updateTask } from "./actions";
import { createBoardStore } from "./store";

const T1 = "11111111-1111-4111-8111-111111111111";

function snapshot(): Snapshot {
  const task: Task = {
    id: T1,
    title: "Alpha",
    assigneeId: null,
    status: "todo",
    priority: "medium",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
  return { tasks: [task], activity: [], seq: 0 };
}

function stubFetch(response: () => Promise<Response>) {
  vi.stubGlobal("fetch", vi.fn(response));
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("actions failure paths", () => {
  it("PATCH 404 removes the task quietly", async () => {
    const store = createBoardStore(snapshot());
    stubFetch(async () => new Response("{}", { status: 404 }));

    const err = await updateTask(store, T1, { status: "done" });

    expect(err).toBeNull();
    expect(store.getState().tasksById[T1]).toBeUndefined();
    expect(store.getState().pendingMutations).toEqual({});
    expect(store.getState().activity).toEqual([]);
  });

  it("DELETE 404 keeps the task deleted quietly", async () => {
    const store = createBoardStore(snapshot());
    stubFetch(async () => new Response("{}", { status: 404 }));

    const err = await deleteTask(store, T1);

    expect(err).toBeNull();
    expect(store.getState().tasksById[T1]).toBeUndefined();
    expect(store.getState().order).toEqual([]);
    expect(store.getState().pendingMutations).toEqual({});
  });

  it("PATCH network error rolls the field back and marks the log entry failed", async () => {
    const store = createBoardStore(snapshot());
    stubFetch(async () => {
      throw new TypeError("offline");
    });

    const err = await updateTask(store, T1, { status: "done" });

    expect(err?.message).toMatch(/network/i);
    expect(store.getState().tasksById[T1]?.status).toBe("todo");
    expect(store.getState().pendingMutations).toEqual({});
    expect(store.getState().activity[0]?.failed).toBe(true);
    expect(store.getState().activity[0]?.pending).toBe(false);
  });

  it("PATCH no-op response settles the pending edit without an SSE echo", async () => {
    const store = createBoardStore(snapshot());
    stubFetch(
      async () =>
        new Response(JSON.stringify({ noop: true, seq: 0 }), { status: 200 }),
    );

    const err = await updateTask(store, T1, { status: "done" });

    expect(err).toBeNull();
    expect(store.getState().pendingMutations).toEqual({});
    expect(store.getState().activity).toEqual([]);
    expect(store.getState().tasksById[T1]?.status).toBe("done");
  });

  it("POST error removes the optimistic task and reports the server message", async () => {
    const store = createBoardStore(snapshot());
    stubFetch(
      async () =>
        new Response(JSON.stringify({ error: "Task id already exists" }), {
          status: 409,
        }),
    );

    const err = await addTask(store, { title: "Gamma" });

    expect(err?.message).toBe("Task id already exists");
    expect(Object.keys(store.getState().tasksById)).toEqual([T1]);
    expect(store.getState().activity[0]?.failed).toBe(true);
  });
});
