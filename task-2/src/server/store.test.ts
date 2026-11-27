import { describe, expect, it, vi } from "vitest";
import { mulberry32, startMockUpdater, tickMock } from "./mockUpdater";
import { createServerStore } from "./store";

describe("server store", () => {
  it("increases seq strictly and bounds the activity ring", () => {
    const store = createServerStore([]);
    for (let i = 0; i < 60; i++) {
      const result = store.createTask({
        id: crypto.randomUUID(),
        title: `T${i}`,
        assigneeId: null,
        status: "todo",
        priority: "low",
      });
      expect(result.ok).toBe(true);
    }
    expect(store.getSeq()).toBe(60);
    expect(store.getSnapshot().activity).toHaveLength(50);
  });

  it("returns 409 on duplicate id and 404 on missing patch/delete", () => {
    const store = createServerStore([]);
    const id = crypto.randomUUID();
    store.createTask({
      id,
      title: "A",
      assigneeId: null,
      status: "todo",
      priority: "medium",
    });
    const dup = store.createTask({
      id,
      title: "B",
      assigneeId: null,
      status: "todo",
      priority: "medium",
    });
    expect(dup.ok).toBe(false);
    if (!dup.ok) expect(dup.status).toBe(409);

    expect(store.patchTask("missing", { title: "x" }).ok).toBe(false);
    expect(store.deleteTask("missing").ok).toBe(false);
  });

  it("emits nothing for a no-op patch", () => {
    const store = createServerStore([]);
    const id = crypto.randomUUID();
    store.createTask({
      id,
      title: "Same",
      assigneeId: null,
      status: "todo",
      priority: "medium",
    });
    const seq = store.getSeq();
    const listener = vi.fn();
    store.subscribe(listener);
    const result = store.patchTask(id, { title: "Same" });
    expect(result).toEqual({ ok: true, noop: true });
    expect(store.getSeq()).toBe(seq);
    expect(listener).not.toHaveBeenCalled();
  });

  it("unsubscribes listeners", () => {
    const store = createServerStore([]);
    const listener = vi.fn();
    const unsub = store.subscribe(listener);
    unsub();
    store.createTask({
      id: crypto.randomUUID(),
      title: "X",
      assigneeId: null,
      status: "todo",
      priority: "low",
    });
    expect(listener).not.toHaveBeenCalled();
  });

  it("runs a deterministic mock updater with fake timers", () => {
    vi.useFakeTimers();
    const store = createServerStore([]);
    store.createTask({
      id: crypto.randomUUID(),
      title: "Seed",
      assigneeId: "m-alex",
      status: "todo",
      priority: "medium",
    });
    const rng = mulberry32(7);
    const timeouts: Array<{ fn: () => void; ms: number }> = [];
    const stop = startMockUpdater({
      store,
      rng,
      minMs: 1000,
      maxMs: 1000,
      scheduler: {
        setTimeout: (fn, ms) => {
          timeouts.push({ fn, ms });
          return timeouts.length;
        },
        clearTimeout: () => undefined,
      },
      now: () => "2026-01-01T00:00:00.000Z",
    });

    expect(timeouts).toHaveLength(1);
    const before = store.getSeq();
    timeouts[0]!.fn();
    expect(store.getSeq()).toBeGreaterThan(before);
    stop();
    vi.useRealTimers();
  });

  it("tickMock is deterministic for a seeded rng", () => {
    const storeA = createServerStore([]);
    const storeB = createServerStore([]);
    for (const store of [storeA, storeB]) {
      store.createTask({
        id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        title: "Seed",
        assigneeId: "m-alex",
        status: "todo",
        priority: "medium",
        now: "2026-01-01T00:00:00.000Z",
      });
    }
    tickMock(storeA, mulberry32(99), () => "2026-01-01T00:01:00.000Z");
    tickMock(storeB, mulberry32(99), () => "2026-01-01T00:01:00.000Z");
    // Activity entry ids are random UUIDs; compare authoritative task state + seq.
    expect(storeA.getSnapshot().tasks).toEqual(storeB.getSnapshot().tasks);
    expect(storeA.getSeq()).toBe(storeB.getSeq());
    expect(storeA.getSnapshot().activity.map((a) => a.type)).toEqual(
      storeB.getSnapshot().activity.map((a) => a.type),
    );
  });
});
