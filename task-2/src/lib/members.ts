import type { Member } from "./types";

/** Fixed team roster shared by client and server. */
export const MEMBERS: readonly Member[] = [
  { id: "m-alex", name: "Alex" },
  { id: "m-ben", name: "Ben" },
  { id: "m-cara", name: "Cara" },
  { id: "m-dana", name: "Dana" },
  { id: "m-erin", name: "Erin" },
] as const;

export const MEMBER_IDS = new Set(MEMBERS.map((m) => m.id));

export function memberName(id: string | null): string {
  if (id === null) return "Unassigned";
  return MEMBERS.find((m) => m.id === id)?.name ?? "Unknown";
}
