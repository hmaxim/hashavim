import { NextResponse } from "next/server";
import {
  ensureMockUpdaterStarted,
  mulberry32,
  tickMock,
} from "@/src/server/mockUpdater";
import { getMockControl, getServerStore } from "@/src/server/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({ paused: getMockControl().mockPaused });
}

export async function POST(request: Request) {
  ensureMockUpdaterStarted();
  const url = new URL(request.url);
  const action = url.searchParams.get("action");

  if (action === "pause") {
    getMockControl().setPaused(true);
    return NextResponse.json({ paused: true });
  }
  if (action === "resume") {
    getMockControl().setPaused(false);
    return NextResponse.json({ paused: false });
  }

  const changed = tickMock(getServerStore(), mulberry32(Date.now() % 1_000_000));
  return NextResponse.json({ changed });
}
