import { createId } from "@/src/lib/ids";
import { MEMBERS } from "@/src/lib/members";
import { PRIORITIES, STATUSES, type Task } from "@/src/lib/types";
import { TITLE_MAX } from "@/src/lib/validation";
import { getMockControl, getServerStore, type ServerStore } from "./store";

export type Rng = () => number;

export type MockScheduler = {
  setTimeout: (fn: () => void, ms: number) => unknown;
  clearTimeout: (id: unknown) => void;
};

export type MockConfig = {
  enabled?: boolean;
  minMs?: number;
  maxMs?: number;
  seed?: number;
  store?: ServerStore;
  rng?: Rng;
  scheduler?: MockScheduler;
  now?: () => string;
};

export function mulberry32(seed: number): Rng {
  let t = seed >>> 0;
  return () => {
    t += 0x6d2b79f5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

function pick<T>(rng: Rng, items: readonly T[]): T {
  return items[Math.floor(rng() * items.length)]!;
}

/** A typo like "2s" would give NaN, and setTimeout(NaN) fires at once in a tight loop. */
function envMs(name: string, fallback: number): number {
  const raw = process.env[name];
  const value = Number(raw);
  return raw && Number.isFinite(value) && value >= 0 ? value : fallback;
}

function delayMs(rng: Rng, minMs: number, maxMs: number): number {
  return Math.floor(minMs + rng() * (maxMs - minMs + 1));
}

/** One random server-attributed mutation. Returns false if nothing changed. */
export function tickMock(
  store: ServerStore,
  rng: Rng,
  now = () => new Date().toISOString(),
): boolean {
  const snapshot = store.getSnapshot();
  const tasks = snapshot.tasks;
  const count = tasks.length;
  const roll = rng();

  // Occasionally add (if under 30) or delete (if over 5).
  if (count < 30 && roll < 0.08) {
    const result = store.createTask({
      id: createId(),
      title: `Server task ${Math.floor(rng() * 1000)}`,
      assigneeId: rng() < 0.2 ? null : pick(rng, MEMBERS).id,
      status: pick(rng, STATUSES),
      priority: pick(rng, PRIORITIES),
      source: "server",
      now: now(),
    });
    return result.ok;
  }

  if (count > 5 && roll < 0.14) {
    const task = pick(rng, tasks);
    const result = store.deleteTask(task.id, { source: "server", now: now() });
    return result.ok;
  }

  if (count === 0) {
    const result = store.createTask({
      id: createId(),
      title: "Server revived the board",
      assigneeId: pick(rng, MEMBERS).id,
      status: "todo",
      priority: "medium",
      source: "server",
      now: now(),
    });
    return result.ok;
  }

  const task = pick(rng, tasks);
  const kind = rng();
  let patch: Partial<Task> = {};

  if (kind < 0.55) {
    const next = pick(
      rng,
      STATUSES.filter((s) => s !== task.status),
    );
    patch = { status: next };
  } else if (kind < 0.75) {
    if (rng() < 0.15) {
      patch = { assigneeId: null };
    } else {
      const candidates = MEMBERS.map((m) => m.id).filter(
        (id) => id !== task.assigneeId,
      );
      patch = {
        assigneeId: candidates.length ? pick(rng, candidates) : null,
      };
    }
  } else if (kind < 0.9) {
    const next = pick(
      rng,
      PRIORITIES.filter((p) => p !== task.priority),
    );
    patch = { priority: next };
  } else {
    const suffix = " (edited)";
    const base = task.title
      .replace(/ \(edited.*\)$/, "")
      .slice(0, TITLE_MAX - suffix.length);
    patch = { title: `${base}${suffix}` };
  }

  const result = store.patchTask(task.id, patch, {
    source: "server",
    now: now(),
  });
  return result.ok && !("noop" in result && result.noop);
}

export function startMockUpdater(config: MockConfig = {}): () => void {
  const enabled =
    config.enabled ??
    (process.env.MOCK_ENABLED === undefined
      ? true
      : process.env.MOCK_ENABLED !== "false");
  if (!enabled) {
    return () => undefined;
  }

  const control = getMockControl();
  if (control.mockStarted && !config.store) {
    return () => undefined;
  }

  const minMs = config.minMs ?? envMs("MOCK_MIN_MS", 2000);
  const maxMs = Math.max(minMs, config.maxMs ?? envMs("MOCK_MAX_MS", 5000));
  const seedEnv = process.env.MOCK_SEED;
  const seed =
    config.seed ??
    (seedEnv !== undefined && seedEnv !== ""
      ? Number(seedEnv)
      : Date.now() % 1_000_000);

  const store = config.store ?? getServerStore();
  const rng = config.rng ?? mulberry32(seed);
  const scheduler: MockScheduler = config.scheduler ?? {
    setTimeout: (fn, ms) => setTimeout(fn, ms),
    clearTimeout: (id) => clearTimeout(id as NodeJS.Timeout),
  };
  const now = config.now ?? (() => new Date().toISOString());

  if (!config.store) {
    control.setStarted(true);
  }

  let timer: unknown = null;
  let stopped = false;

  const schedule = () => {
    if (stopped) return;
    timer = scheduler.setTimeout(() => {
      if (stopped) return;
      if (!getMockControl().mockPaused) {
        tickMock(store, rng, now);
      }
      schedule();
    }, delayMs(rng, minMs, maxMs));
  };

  schedule();

  return () => {
    stopped = true;
    if (timer !== null) scheduler.clearTimeout(timer);
  };
}

export function ensureMockUpdaterStarted(): void {
  startMockUpdater();
}
