import { Board } from "@/src/components/Board";
import { ensureMockUpdaterStarted } from "@/src/server/mockUpdater";
import { getServerStore } from "@/src/server/store";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export default function HomePage() {
  ensureMockUpdaterStarted();
  const initialSnapshot = getServerStore().getSnapshot();
  return <Board initialSnapshot={initialSnapshot} />;
}
