import { describe, expect, it } from "vitest";
import { createEventStream } from "./eventStream";
import { createServerStore, type ServerStore } from "./store";

async function readMessages(
  stream: ReadableStream<Uint8Array>,
  count: number,
): Promise<string[]> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let text = "";
  while (text.split("\n\n").filter(Boolean).length < count) {
    const { value, done } = await reader.read();
    if (done) break;
    text += decoder.decode(value);
  }
  reader.releaseLock();
  return text.split("\n\n").filter(Boolean);
}

function newTask(store: ServerStore, title: string) {
  return store.createTask({
    id: crypto.randomUUID(),
    title,
    assigneeId: null,
    status: "todo",
    priority: "low",
  });
}

describe("createEventStream", () => {
  it("delivers a write that lands right after the snapshot is read", async () => {
    const real = createServerStore([]);
    // Simulate a concurrent write between reading the snapshot and going live.
    const racy: ServerStore = {
      ...real,
      getSnapshot: () => {
        const snapshot = real.getSnapshot();
        newTask(real, "Raced");
        return snapshot;
      },
    };
    const abort = new AbortController();

    const messages = await readMessages(
      createEventStream(racy, abort.signal),
      2,
    );
    abort.abort();

    expect(messages[0]).toContain("event: snapshot");
    expect(messages[0]).toContain('"seq":0');
    expect(messages[1]).toContain("event: event");
    expect(messages[1]).toContain('"seq":1');
  });

  it("does not resend events already contained in the snapshot", async () => {
    const real = createServerStore([]);
    const racy: ServerStore = {
      ...real,
      getSnapshot: () => {
        newTask(real, "Before snapshot");
        return real.getSnapshot();
      },
    };
    const abort = new AbortController();
    const stream = createEventStream(racy, abort.signal);

    const [snapshot] = await readMessages(stream, 1);
    newTask(real, "Live");
    const [live] = await readMessages(stream, 1);
    abort.abort();

    expect(snapshot).toContain('"seq":1');
    expect(live).toContain('"seq":2');
  });
});
