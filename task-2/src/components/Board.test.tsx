import {
  act,
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useEffect } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Snapshot, Task, TaskEvent } from "@/src/lib/types";
import { useEventStream } from "@/src/hooks/useEventStream";
import { BoardStoreProvider, useBoardStoreApi } from "@/src/state/store";
import { ActivityLog } from "./ActivityLog";
import { AssigneeView } from "./AssigneeView";
import { SummaryPanel } from "./SummaryPanel";
import { TaskEditor } from "./TaskEditor";
import { TaskList } from "./TaskList";

function task(partial: Partial<Task> & Pick<Task, "id" | "title">): Task {
  return {
    assigneeId: "m-alex",
    status: "todo",
    priority: "medium",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...partial,
  };
}

const seedSnapshot: Snapshot = {
  tasks: [
    task({ id: "11111111-1111-4111-8111-111111111111", title: "Alpha" }),
    task({
      id: "22222222-2222-4222-8222-222222222222",
      title: "Beta",
      status: "in_progress",
      assigneeId: "m-ben",
    }),
  ],
  activity: [],
  seq: 0,
};

class FakeEventSource {
  static instances: FakeEventSource[] = [];
  url: string;
  listeners = new Map<string, Set<(ev: MessageEvent) => void>>();
  onerror: ((ev: Event) => void) | null = null;
  closed = false;

  constructor(url: string) {
    this.url = url;
    FakeEventSource.instances.push(this);
  }

  addEventListener(type: string, cb: (ev: MessageEvent) => void) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type)!.add(cb);
  }

  close() {
    this.closed = true;
  }

  emit(type: string, data: unknown) {
    this.emitRaw(type, JSON.stringify(data));
  }

  emitRaw(type: string, data: string) {
    const event = { data } as MessageEvent;
    for (const cb of this.listeners.get(type) ?? []) cb(event);
  }
}

function fakeSourceFactory(url: string): EventSource {
  return new FakeEventSource(url) as unknown as EventSource;
}

function TestBoard({ snapshot = seedSnapshot }: { snapshot?: Snapshot }) {
  return (
    <BoardStoreProvider initialSnapshot={snapshot}>
      <Harness />
    </BoardStoreProvider>
  );
}

function Harness() {
  const onError = () => undefined;
  useEventStream(fakeSourceFactory);
  return (
    <div data-testid="board-root">
      <TaskList onError={onError} />
      <TaskEditor onError={onError} />
      <SummaryPanel />
      <AssigneeView />
      <ActivityLog />
    </div>
  );
}

function listPanel() {
  return screen.getByRole("region", { name: "Tasks" });
}

function editorPanel() {
  return screen.getByRole("region", { name: "Editor" });
}

describe("Board integration", () => {
  beforeEach(() => {
    FakeEventSource.instances = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url === "/api/tasks" && init?.method === "POST") {
          return new Response(JSON.stringify({ ok: true }), { status: 201 });
        }
        if (url.includes("/api/tasks/") && init?.method === "DELETE") {
          return new Response(null, { status: 204 });
        }
        if (url.includes("/api/tasks/") && init?.method === "PATCH") {
          return new Response(JSON.stringify({ ok: true }), { status: 200 });
        }
        return new Response("not found", { status: 404 });
      }),
    );
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("updates every panel when status changes in the list", async () => {
    const user = userEvent.setup();
    render(<TestBoard />);

    const alphaRow = within(listPanel())
      .getByRole("button", { name: "Alpha" })
      .closest("li")!;
    const statusSelect = within(alphaRow).getByLabelText(/Status for Alpha/i);
    await user.selectOptions(statusSelect, "done");

    await waitFor(() => {
      expect(screen.getByText(/changed status of 'Alpha'/i)).toBeInTheDocument();
    });
    expect(within(alphaRow).getByDisplayValue("done")).toBeInTheDocument();
  });

  it("updates list/summary/grouping when assignee changes in the editor", async () => {
    const user = userEvent.setup();
    render(<TestBoard />);
    await user.click(within(listPanel()).getByRole("button", { name: "Alpha" }));
    await user.selectOptions(
      within(editorPanel()).getByLabelText("Assignee"),
      "m-cara",
    );

    await waitFor(() => {
      expect(
        within(listPanel()).getAllByDisplayValue("Cara").length,
      ).toBeGreaterThan(0);
    });
  });

  it("adds and deletes tasks across panels", async () => {
    const user = userEvent.setup();
    render(<TestBoard />);
    await user.type(screen.getByLabelText("New task title"), "Gamma");
    await user.click(screen.getByRole("button", { name: "Add task" }));

    expect(
      await within(listPanel()).findByRole("button", { name: "Gamma" }),
    ).toBeInTheDocument();
    expect(screen.getByText(/created 'Gamma'/i)).toBeInTheDocument();

    await user.click(within(listPanel()).getByRole("button", { name: "Gamma" }));
    await user.click(
      within(editorPanel()).getByRole("button", { name: "Delete task" }),
    );

    await waitFor(() => {
      expect(
        within(listPanel()).queryByRole("button", { name: "Gamma" }),
      ).not.toBeInTheDocument();
    });
    expect(screen.getByText(/Selected task was deleted/i)).toBeInTheDocument();
  });

  it("applies a server event from a fake EventSource to every panel", async () => {
    render(<TestBoard />);
    const source = FakeEventSource.instances.at(-1)!;
    source.emit("snapshot", seedSnapshot);

    const event: TaskEvent = {
      seq: 1,
      type: "task.updated",
      taskId: "11111111-1111-4111-8111-111111111111",
      task: task({
        id: "11111111-1111-4111-8111-111111111111",
        title: "Alpha",
        status: "in_review",
      }),
      activity: {
        id: "srv",
        at: "2026-01-01T00:05:00.000Z",
        source: "server",
        type: "updated",
        taskId: "11111111-1111-4111-8111-111111111111",
        taskTitle: "Alpha",
        changes: [{ field: "status", from: "todo", to: "in_review" }],
      },
    };
    source.emit("event", event);

    await waitFor(() => {
      expect(screen.getByText(/Server changed status of 'Alpha'/i)).toBeInTheDocument();
    });
    expect(screen.getAllByDisplayValue("in review").length).toBeGreaterThan(0);
  });

  it("reconnects instead of breaking when an SSE message is not valid JSON", () => {
    vi.useFakeTimers();
    try {
      render(<TestBoard />);
      const first = FakeEventSource.instances.at(-1)!;
      act(() => first.emit("snapshot", seedSnapshot));

      act(() => first.emitRaw("event", "{not json"));
      expect(first.closed).toBe(true);

      act(() => vi.advanceTimersByTime(1000));
      const second = FakeEventSource.instances.at(-1)!;
      expect(second).not.toBe(first);
      expect(second.closed).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it("reconnects for a fresh snapshot when an SSE seq is skipped", () => {
    vi.useFakeTimers();
    try {
      render(<TestBoard />);
      const first = FakeEventSource.instances.at(-1)!;
      act(() => first.emit("snapshot", seedSnapshot));

      act(() =>
        first.emit("event", {
          seq: 2,
          type: "task.deleted",
          taskId: "11111111-1111-4111-8111-111111111111",
          activity: {
            id: "gap",
            at: "2026-01-01T00:00:00.000Z",
            source: "server",
            type: "deleted",
            taskId: "11111111-1111-4111-8111-111111111111",
            taskTitle: "Alpha",
            changes: [],
          },
        } satisfies TaskEvent),
      );
      expect(first.closed).toBe(true);
      // The gapped event is not applied.
      expect(
        within(listPanel()).getByRole("button", { name: "Alpha" }),
      ).toBeInTheDocument();

      act(() => vi.advanceTimersByTime(250));
      const second = FakeEventSource.instances.at(-1)!;
      expect(second).not.toBe(first);
      expect(second.closed).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it("resyncs on reconnect and keeps a pending mutation", async () => {
    function WithPending() {
      const store = useBoardStoreApi();
      useEffect(() => {
        store.getState().dispatch({
          type: "optimistic.update",
          taskId: "11111111-1111-4111-8111-111111111111",
          patch: { priority: "high" },
          previous: { priority: "medium" },
          mutationId: "pending-1",
          activity: {
            id: "p1",
            at: "2026-01-01T00:00:00.000Z",
            source: "user",
            type: "updated",
            taskId: "11111111-1111-4111-8111-111111111111",
            taskTitle: "Alpha",
            changes: [{ field: "priority", from: "medium", to: "high" }],
            mutationId: "pending-1",
            pending: true,
          },
        });
      }, [store]);
      return <Harness />;
    }

    render(
      <BoardStoreProvider initialSnapshot={seedSnapshot}>
        <WithPending />
      </BoardStoreProvider>,
    );

    const source = FakeEventSource.instances.at(-1)!;
    source.emit("snapshot", {
      tasks: [
        task({
          id: "11111111-1111-4111-8111-111111111111",
          title: "Alpha",
          priority: "medium",
        }),
      ],
      activity: [],
      seq: 9,
    });

    await waitFor(() => {
      expect(screen.getAllByDisplayValue("high").length).toBeGreaterThan(0);
    });
    expect(screen.getByText(/pending/i)).toBeInTheDocument();
  });

  it("keeps the title draft when an external title change arrives while typing", async () => {
    const user = userEvent.setup();
    let injectRemoteTitle: (() => void) | null = null;

    function TitleDraftCase() {
      const store = useBoardStoreApi();
      injectRemoteTitle = () => {
        store.getState().dispatch({
          type: "server",
          event: {
            seq: store.getState().lastSeq + 1,
            type: "task.updated",
            taskId: "11111111-1111-4111-8111-111111111111",
            task: task({
              id: "11111111-1111-4111-8111-111111111111",
              title: "Remote title",
            }),
            activity: {
              id: "r1",
              at: "2026-01-01T00:06:00.000Z",
              source: "server",
              type: "updated",
              taskId: "11111111-1111-4111-8111-111111111111",
              taskTitle: "Remote title",
              changes: [{ field: "title", from: "Alpha", to: "Remote title" }],
            },
          } satisfies TaskEvent,
        });
      };
      useEventStream(fakeSourceFactory);
      return (
        <div data-testid="board-root">
          <TaskList onError={() => undefined} />
          <TaskEditor onError={() => undefined} />
        </div>
      );
    }

    render(
      <BoardStoreProvider initialSnapshot={seedSnapshot}>
        <TitleDraftCase />
      </BoardStoreProvider>,
    );

    await user.click(within(listPanel()).getByRole("button", { name: "Alpha" }));
    const input = within(editorPanel()).getByLabelText("Title");
    await user.click(input);
    await user.clear(input);
    await user.type(input, "My draft");
    expect(input).toHaveFocus();
    // Inject without blurring the title field (clicking elsewhere would blur).
    act(() => {
      injectRemoteTitle?.();
    });

    expect(input).toHaveValue("My draft");
    await waitFor(() => {
      expect(screen.getByText(/Title changed elsewhere/i)).toBeInTheDocument();
    });
  });
});
