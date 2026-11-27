import { NextResponse } from "next/server";
import { validateCreate } from "@/src/lib/validation";
import { ensureMockUpdaterStarted } from "@/src/server/mockUpdater";
import { getServerStore } from "@/src/server/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  ensureMockUpdaterStarted();
  const snapshot = getServerStore().getSnapshot();
  return NextResponse.json(snapshot);
}

export async function POST(request: Request) {
  ensureMockUpdaterStarted();
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const validated = validateCreate(
    body as {
      id: unknown;
      title: unknown;
      assigneeId?: unknown;
      status?: unknown;
      priority?: unknown;
      mutationId?: unknown;
    },
  );
  if (!validated.ok) {
    return NextResponse.json({ error: validated.error }, { status: 400 });
  }

  const result = getServerStore().createTask({
    ...validated.value,
    source: "user",
  });

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }

  return NextResponse.json(result.task, { status: 201 });
}
