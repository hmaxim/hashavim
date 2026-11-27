# Task 2 — Decisions

> **AI tools are allowed and encouraged. You must be able to explain every line you submit.**
> **Clear decisions and edge-case handling matter more than completeness. If you skip something, say so and explain why.**

## 1. AI usage

Cursor (Composer) scaffolded the Next.js app, drafted the reducer/SSE/server store, UI panels, tests, and this documentation. I reviewed the optimistic/echo path, selector memoization (to avoid Zustand render loops), and StrictMode EventSource handling line by line, then fixed failing tests. Full session detail: [AI_USAGE.md](AI_USAGE.md).

## 2. Decision log

| Decision | Alternatives considered | Why this choice | Consequence/risk |
|---|---|---|---|
| Self-contained `task-2/` folder | Monorepo workspace | Assignment isolation; clean clone runs with one `cd` | Duplicate tooling vs Task 1 |
| Next.js App Router (same process) | Vite + separate Express | One command, RSC initial snapshot, route handlers for REST/SSE | Not multi-instance / not serverless |
| Zustand + pure reducer | Redux Toolkit; Context + useReducer; TanStack Query | Small API, selective subscriptions, one `applyEvent` path | Must memoize selectors carefully |
| Normalized `tasksById` + `order` | Array-only store | O(1) updates; order preserved for the list | Extra mapping in selectors |
| Derived data via selectors only | Store counts in state | Impossible for counts to drift | New-array selectors can loop if unmemoized |
| SSE | WebSocket; polling | Uni-directional server push; no extra library | Needs snapshot resync on gaps |
| Server-authoritative + optimistic UI | Wait for server; fully local | Instant UX; echo reconciles with `mutationId` | Rollback logic must be field-aware |
| `seq` + snapshot-on-connect | Vector clocks; operational transform | Simple total order for one process | Multi-instance needs a shared bus |
| Server-owned activity ring (50) | Client-only log | Same log across tabs/reloads (while process lives) | Lost on process restart |
| Client-generated UUIDs | Server ids + temp remapping | No temp-id rewrite for creates | Client must send valid unique UUIDs |
| Conflict = last write wins (server order) | Field merge UI | Clear, testable convergence | Concurrent edits can surprise users |
| In-memory `globalThis` store | SQLite / Redis | Fast to build and demo | Data not durable; single process |

## 3. Edge cases

| Edge case | Handled? | How / why skipped | Test |
|---|---|---|---|
| User + server edit same task | Yes | Server `seq` order wins; echo replaces optimistic | `reducer.test.ts` echo + Board SSE |
| Own change echo | Yes | `mutationId` resolves pending; no duplicate log | `reducer.test.ts` echo |
| Duplicate / stale SSE `seq` | Yes | Drop `seq <= lastSeq` | `reducer.test.ts` stale |
| `seq` gap | Yes | `needsResync` → reconnect + snapshot | `reducer.test.ts` gap; Board reconnect |
| Optimistic request fails | Yes | `markFailed` rolls back still-optimistic fields | `reducer.test.ts` rollback |
| Selected task deleted | Yes | Reducer clears `selectedId`; editor notice | `reducer.test.ts`; Board delete |
| Pending PATCH then 404 | Yes | Rollback + `ensureDeleted`, no error toast | `actions.ts` (covered via delete/404 paths) |
| Unassigned / unknown assignee | Yes | Selectors include Unassigned + unknown bucket | `reducer.test.ts` selectors |
| Empty board | Yes | Empty states; zero counts | selectors empty/mixed |
| Invalid / empty / long title | Yes | Shared validation client + server | validation used in actions/API |
| Rapid consecutive edits | Yes | Separate `mutationId`s; last server apply wins | implicit in optimistic design |
| No-op edits | Yes | Client skips; server returns noop without event | `store.test.ts` noop |
| Two browser tabs | Yes | Shared SSE hub | Manual / demo |
| StrictMode double effects | Yes | Generation counter + close previous source | `useEventStream` |
| Hydration timestamps | Yes | Format times only after mount | `ActivityLog` |
| Server restart while connected | Partially | Reconnect gets new snapshot; data not persisted | Documented limitation |
| Activity log growth | Yes | Server 50 / client display 20, ring buffer | `store.test.ts` bound |

## 4. Skipped or simplified, and why

- **Persistence** — out of scope; production would use a DB and still broadcast events.
- **Auth** — not required; production would gate mutations per board/member.
- **Multi-instance** — would need Redis (or similar) for SSE fan-out and store.
- **Offline queue** — skipped for clarity; production: durable outbox + idempotency.
- **Per-field conflict UI** — LWW is enough to explain; production may show merge hints.
- **E2E browser tests** — RTL + unit cover the shared-state contract; Playwright optional later.

## 5. Assumptions

- Single Node process for the lifetime of a demo session.
- Five fixed team members are enough; no member CRUD.
- UUID v4-shaped ids from `crypto.randomUUID()`.
- “Unassigned” is `assigneeId: null`.

## 6. Code walkthrough

- **`src/state/reducer.ts`** — sole mutation path: snapshot, server events, optimistic create/update/delete, rollback/markFailed, selection, connection, ensureDeleted.
- **`src/state/selectors.ts`** — memoized counts/groupings/ordered tasks/activity slice keyed on store references.
- **`src/hooks/useEventStream.ts`** — one live `EventSource`; snapshot + event handlers; reconnect on error/gap; StrictMode-safe.
- **`src/state/actions.ts`** — optimistic dispatch then fetch; field-aware failure handling; quiet 404.
- **`src/server/store.ts`** — in-memory authoritative store on `globalThis`; seq + activity + subscribe.
- **`src/server/mockUpdater.ts`** — injectable RNG/timer; random server-attributed changes.
- **`src/components/*`** — read only via selectors; editor keeps a local title draft.

## 7. Known weaknesses and next steps

- In-memory only; add persistence + shared bus before horizontal scale.
- LWW can overwrite concurrent field edits; consider per-field versions.
- Mock updater can delete user work; pause control mitigates demos.
- Next: Playwright two-tab test, structured logging, auth.
