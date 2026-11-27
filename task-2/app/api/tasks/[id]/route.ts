import { NextResponse } from "next/server";
import { validatePatch } from "@/src/lib/validation";
import { ensureMockUpdaterStarted } from "@/src/server/mockUpdater";
import { getServerStore } from "@/src/server/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, context: RouteContext) {
  ensureMockUpdaterStarted();
  const { id } = await context.params;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const validated = validatePatch(body as { patch?: unknown; mutationId?: unknown });
  if (!validated.ok) {
    return NextResponse.json({ error: validated.error }, { status: 400 });
  }

  const store = getServerStore();
  const result = store.patchTask(id, validated.value.patch, {
    mutationId: validated.value.mutationId,
    source: "user",
  });

  if (!result.ok) {
    return NextResponse.json({ error: "Task not found" }, { status: 404 });
  }

  // `seq` lets the client settle its pending edit even if no echo follows.
  if (result.noop) {
    return NextResponse.json({ noop: true, seq: store.getSeq() });
  }

  return NextResponse.json({ task: result.task, seq: result.event.seq });
}

export async function DELETE(request: Request, context: RouteContext) {
  ensureMockUpdaterStarted();
  const { id } = await context.params;
  const url = new URL(request.url);
  const mutationId = url.searchParams.get("mutationId") ?? undefined;

  const result = getServerStore().deleteTask(id, {
    mutationId,
    source: "user",
  });

  if (!result.ok) {
    return NextResponse.json({ error: "Task not found" }, { status: 404 });
  }

  return NextResponse.json({ seq: result.event.seq });
}
