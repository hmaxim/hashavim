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

  const result = getServerStore().patchTask(id, validated.value.patch, {
    mutationId: validated.value.mutationId,
    source: "user",
  });

  if (!result.ok) {
    return NextResponse.json({ error: "Task not found" }, { status: 404 });
  }

  if (result.noop) {
    return NextResponse.json({ noop: true });
  }

  return NextResponse.json(result.task);
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

  return new NextResponse(null, { status: 204 });
}
