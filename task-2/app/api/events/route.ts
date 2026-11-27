import { createEventStream } from "@/src/server/eventStream";
import { ensureMockUpdaterStarted } from "@/src/server/mockUpdater";
import { getServerStore } from "@/src/server/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  ensureMockUpdaterStarted();
  const stream = createEventStream(getServerStore(), request.signal);

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
