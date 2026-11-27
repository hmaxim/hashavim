import { MEMBER_IDS } from "./members";
import {
  PRIORITIES,
  STATUSES,
  type Priority,
  type Status,
  type TaskPatch,
} from "./types";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isUuid(value: string): boolean {
  return UUID_RE.test(value);
}

export function isStatus(value: unknown): value is Status {
  return typeof value === "string" && (STATUSES as string[]).includes(value);
}

export function isPriority(value: unknown): value is Priority {
  return typeof value === "string" && (PRIORITIES as string[]).includes(value);
}

export function isAssigneeId(value: unknown): value is string | null {
  if (value === null) return true;
  return typeof value === "string" && MEMBER_IDS.has(value);
}

export type ValidationResult =
  | { ok: true; title: string }
  | { ok: false; error: string };

export function validateTitle(raw: unknown): ValidationResult {
  if (typeof raw !== "string") {
    return { ok: false, error: "Title must be a string" };
  }
  const title = raw.trim();
  if (title.length < 1) {
    return { ok: false, error: "Title is required" };
  }
  if (title.length > 120) {
    return { ok: false, error: "Title must be at most 120 characters" };
  }
  return { ok: true, title };
}

export type CreateTaskInput = {
  id: unknown;
  title: unknown;
  assigneeId?: unknown;
  status?: unknown;
  priority?: unknown;
  mutationId?: unknown;
};

export type ValidatedCreate = {
  id: string;
  title: string;
  assigneeId: string | null;
  status: Status;
  priority: Priority;
  mutationId?: string;
};

export function validateCreate(
  body: CreateTaskInput,
): { ok: true; value: ValidatedCreate } | { ok: false; error: string } {
  if (typeof body.id !== "string" || !isUuid(body.id)) {
    return { ok: false, error: "id must be a UUID" };
  }
  const titleResult = validateTitle(body.title);
  if (!titleResult.ok) return titleResult;

  const assigneeId = body.assigneeId === undefined ? null : body.assigneeId;
  if (!isAssigneeId(assigneeId)) {
    return { ok: false, error: "assigneeId must be a known member id or null" };
  }

  const status = body.status === undefined ? "todo" : body.status;
  if (!isStatus(status)) {
    return { ok: false, error: "Invalid status" };
  }

  const priority = body.priority === undefined ? "medium" : body.priority;
  if (!isPriority(priority)) {
    return { ok: false, error: "Invalid priority" };
  }

  let mutationId: string | undefined;
  if (body.mutationId !== undefined) {
    if (typeof body.mutationId !== "string" || body.mutationId.length === 0) {
      return { ok: false, error: "mutationId must be a non-empty string" };
    }
    mutationId = body.mutationId;
  }

  return {
    ok: true,
    value: {
      id: body.id,
      title: titleResult.title,
      assigneeId,
      status,
      priority,
      mutationId,
    },
  };
}

export type ValidatedPatch = {
  patch: TaskPatch;
  mutationId?: string;
};

export function validatePatch(
  body: { patch?: unknown; mutationId?: unknown },
): { ok: true; value: ValidatedPatch } | { ok: false; error: string } {
  if (!body.patch || typeof body.patch !== "object" || Array.isArray(body.patch)) {
    return { ok: false, error: "patch object is required" };
  }

  const raw = body.patch as Record<string, unknown>;
  const patch: TaskPatch = {};
  let known = 0;

  if ("title" in raw) {
    known += 1;
    const titleResult = validateTitle(raw.title);
    if (!titleResult.ok) return titleResult;
    patch.title = titleResult.title;
  }
  if ("assigneeId" in raw) {
    known += 1;
    if (!isAssigneeId(raw.assigneeId)) {
      return { ok: false, error: "assigneeId must be a known member id or null" };
    }
    patch.assigneeId = raw.assigneeId;
  }
  if ("status" in raw) {
    known += 1;
    if (!isStatus(raw.status)) {
      return { ok: false, error: "Invalid status" };
    }
    patch.status = raw.status;
  }
  if ("priority" in raw) {
    known += 1;
    if (!isPriority(raw.priority)) {
      return { ok: false, error: "Invalid priority" };
    }
    patch.priority = raw.priority;
  }

  if (known === 0) {
    return { ok: false, error: "patch must include at least one known field" };
  }

  let mutationId: string | undefined;
  if (body.mutationId !== undefined) {
    if (typeof body.mutationId !== "string" || body.mutationId.length === 0) {
      return { ok: false, error: "mutationId must be a non-empty string" };
    }
    mutationId = body.mutationId;
  }

  return { ok: true, value: { patch, mutationId } };
}
