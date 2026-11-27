export type Status = "todo" | "in_progress" | "in_review" | "done";
export type Priority = "low" | "medium" | "high";

export type Member = {
  id: string;
  name: string;
};

export type Task = {
  id: string;
  title: string;
  assigneeId: string | null;
  status: Status;
  priority: Priority;
  createdAt: string;
  updatedAt: string;
};

export type TaskPatch = Partial<
  Pick<Task, "title" | "assigneeId" | "status" | "priority">
>;

export type ActivityChange = {
  field: string;
  from: unknown;
  to: unknown;
};

export type ActivityEntry = {
  id: string;
  at: string;
  source: "user" | "server";
  type: "created" | "updated" | "deleted";
  taskId: string;
  taskTitle: string;
  changes: ActivityChange[];
  mutationId?: string;
  pending?: boolean;
  failed?: boolean;
  /** Client-only: this tab made the change (label "You" instead of "A user"). */
  own?: boolean;
};

export type TaskEvent = {
  seq: number;
  type: "task.created" | "task.updated" | "task.deleted";
  task?: Task;
  taskId: string;
  mutationId?: string;
  activity: ActivityEntry;
};

export type Snapshot = {
  tasks: Task[];
  activity: ActivityEntry[];
  seq: number;
};

export type ConnectionStatus = "connected" | "reconnecting" | "disconnected";

export type PendingMutation = {
  mutationId: string;
  kind: "create" | "update" | "delete";
  taskId: string;
  /** Previous field values before optimistic update (update only). */
  previous?: TaskPatch;
  /** Values applied optimistically (update only). */
  optimistic?: TaskPatch;
  /** Full task for create (remove on rollback) or delete (restore on rollback). */
  taskSnapshot?: Task;
  /**
   * Server seq returned by the HTTP response. Once lastSeq reaches it the
   * change is in our copy, even if its echo never arrives (no-op, or it was
   * folded into a reconnect snapshot).
   */
  ackSeq?: number;
  /** The server already had these values: drop the log row instead of confirming it. */
  ackNoop?: boolean;
};

export type BoardState = {
  tasksById: Record<string, Task>;
  order: string[];
  selectedId: string | null;
  activity: ActivityEntry[];
  pendingMutations: Record<string, PendingMutation>;
  lastSeq: number;
  connection: ConnectionStatus;
  /** Set when an SSE gap is detected; the stream hook reconnects. */
  needsResync: boolean;
};

export const STATUSES: Status[] = [
  "todo",
  "in_progress",
  "in_review",
  "done",
];

export const PRIORITIES: Priority[] = ["low", "medium", "high"];

export const ACTIVITY_CLIENT_LIMIT = 50;
