import { ensureMockUpdaterStarted } from "@/src/server/mockUpdater";
import { getServerStore } from "@/src/server/store";
import type { TaskEvent } from "@/src/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  ensureMockUpdaterStarted();
  const store = getServerStore();
  const encoder = new TextEncoder();

  let unsubscribe: (() => void) | null = null;
  let heartbeat: ReturnType<typeof setInterval> | null = null;
  let closed = false;

  const stream = new ReadableStream({
    start(controller) {
      const send = (payload: string) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(payload));
        } catch {
          cleanup();
        }
      };

      const snapshot = store.getSnapshot();
      send(`event: snapshot\ndata: ${JSON.stringify(snapshot)}\n\n`);

      const onEvent = (event: TaskEvent) => {
        send(`event: event\ndata: ${JSON.stringify(event)}\n\n`);
      };

      unsubscribe = store.subscribe(onEvent);

      heartbeat = setInterval(() => {
        send(`: heartbeat\n\n`);
      }, 15_000);

      const cleanup = () => {
        if (closed) return;
        closed = true;
        if (unsubscribe) unsubscribe();
        if (heartbeat) clearInterval(heartbeat);
        try {
          controller.close();
        } catch {
          // already closed
        }
      };

      request.signal.addEventListener("abort", cleanup);
    },
    cancel() {
      closed = true;
      if (unsubscribe) unsubscribe();
      if (heartbeat) clearInterval(heartbeat);
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
