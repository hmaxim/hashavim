import type { TaskEvent } from "@/src/lib/types";
import type { ServerStore } from "./store";

/**
 * SSE body for one client: a snapshot, then every later event in seq order.
 * Subscribes before reading the snapshot so no write can fall in between.
 */
export function createEventStream(
  store: ServerStore,
  signal: AbortSignal,
  heartbeatMs = 15_000,
): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  let closed = false;
  let unsubscribe: (() => void) | null = null;
  let heartbeat: ReturnType<typeof setInterval> | null = null;

  const stop = () => {
    closed = true;
    unsubscribe?.();
    if (heartbeat) clearInterval(heartbeat);
  };

  return new ReadableStream({
    start(controller) {
      const cleanup = () => {
        if (closed) return;
        stop();
        try {
          controller.close();
        } catch {
          // already closed
        }
      };

      const send = (payload: string) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(payload));
        } catch {
          cleanup();
        }
      };
      const sendEvent = (event: TaskEvent) =>
        send(`event: event\ndata: ${JSON.stringify(event)}\n\n`);

      let live = false;
      const buffered: TaskEvent[] = [];
      unsubscribe = store.subscribe((event) => {
        if (live) sendEvent(event);
        else buffered.push(event);
      });

      const snapshot = store.getSnapshot();
      send(`event: snapshot\ndata: ${JSON.stringify(snapshot)}\n\n`);
      for (const event of buffered) {
        if (event.seq > snapshot.seq) sendEvent(event);
      }
      live = true;

      heartbeat = setInterval(() => send(`: heartbeat\n\n`), heartbeatMs);
      signal.addEventListener("abort", cleanup);
    },
    cancel: stop,
  });
}
