import type { Task } from "@/src/lib/types";

const FIXED_NOW = "2026-01-15T10:00:00.000Z";

/** Deterministic seed tasks for a realistic board. */
export function createSeedTasks(): Task[] {
  const base = Date.parse(FIXED_NOW);
  const at = (minutesAgo: number) =>
    new Date(base - minutesAgo * 60_000).toISOString();

  return [
    {
      id: "11111111-1111-4111-8111-111111111111",
      title: "Draft onboarding checklist",
      assigneeId: "m-alex",
      status: "todo",
      priority: "high",
      createdAt: at(120),
      updatedAt: at(120),
    },
    {
      id: "22222222-2222-4222-8222-222222222222",
      title: "Review API rate limits",
      assigneeId: "m-ben",
      status: "in_progress",
      priority: "medium",
      createdAt: at(110),
      updatedAt: at(40),
    },
    {
      id: "33333333-3333-4333-8333-333333333333",
      title: "Update billing copy",
      assigneeId: "m-cara",
      status: "in_review",
      priority: "low",
      createdAt: at(100),
      updatedAt: at(30),
    },
    {
      id: "44444444-4444-4444-8444-444444444444",
      title: "Ship notifications banner",
      assigneeId: "m-dana",
      status: "done",
      priority: "medium",
      createdAt: at(200),
      updatedAt: at(20),
    },
    {
      id: "55555555-5555-4555-8555-555555555555",
      title: "Investigate flaky CI",
      assigneeId: null,
      status: "todo",
      priority: "high",
      createdAt: at(90),
      updatedAt: at(90),
    },
    {
      id: "66666666-6666-4666-8666-666666666666",
      title: "Polish empty states",
      assigneeId: "m-erin",
      status: "in_progress",
      priority: "low",
      createdAt: at(80),
      updatedAt: at(25),
    },
    {
      id: "77777777-7777-4777-8777-777777777777",
      title: "Write quota design notes",
      assigneeId: "m-alex",
      status: "in_review",
      priority: "high",
      createdAt: at(70),
      updatedAt: at(15),
    },
    {
      id: "88888888-8888-4888-8888-888888888888",
      title: "Cleanup dead feature flags",
      assigneeId: null,
      status: "todo",
      priority: "medium",
      createdAt: at(60),
      updatedAt: at(60),
    },
    {
      id: "99999999-9999-4999-8999-999999999999",
      title: "Pair on SSE reconnect",
      assigneeId: "m-ben",
      status: "done",
      priority: "high",
      createdAt: at(50),
      updatedAt: at(10),
    },
  ];
}
