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
| SSE subscribes before reading the snapshot | Snapshot first, then subscribe | A write between the two steps would otherwise never reach that client; buffered events with `seq <= snapshot.seq` are dropped | Small per-connection buffer during connect |
| Re-apply pending edits after each server event for that task | Trust the server copy until every echo arrives | The echo of an older edit must not hide a newer edit still in flight | Re-apply runs per event; cheap at board size |
| Mutation responses return the server `seq`; the client settles a pending edit once `lastSeq` reaches it | Rely only on the SSE echo; server timeout to drop pending | Some edits never get an echo (no-op on the server, or the echo is folded into a reconnect snapshot). Without the ack they stay pending and get re-applied over newer server data | One extra `ack` event in the reducer; responses changed shape (`{ task, seq }`, `{ noop, seq }`, `{ seq }`) |
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
| `seq` gap | Yes | `needsResync` → hook closes the stream and reconnects for a snapshot; the gapped event is not applied | `reducer.test.ts` gap; `Board.test.tsx` skipped seq reconnect |
| Write lands while a client is connecting | Yes | Stream subscribes first, buffers, sends snapshot, then flushes only newer events | `eventStream.test.ts` |
| Malformed SSE message | Yes | Parse failure closes the connection and reconnects for a fresh snapshot | `Board.test.tsx` invalid JSON |
| Optimistic request fails | Yes | `markFailed` rolls back still-optimistic fields and marks the log row failed | `reducer.test.ts` rollback; `actions.test.ts` network error + POST 409 |
| Selected task deleted | Yes | Reducer clears `selectedId`; editor notice | `reducer.test.ts`; Board delete |
| Pending PATCH or DELETE then 404 | Yes | Rollback + `ensureDeleted`, no error shown | `actions.test.ts` PATCH 404 + DELETE 404 |
| Unassigned / unknown assignee | Yes | Selectors include Unassigned + unknown bucket | `reducer.test.ts` selectors |
| Empty board | Yes | Empty states; zero counts | selectors empty/mixed |
| Invalid / empty / long title | Yes | Shared validation client + server | validation used in actions/API |
| Rapid consecutive edits | Yes | Separate `mutationId`s; after each server event the remaining pending edits for that task are re-applied, so the UI never flicks back | `reducer.test.ts` older echo keeps newer pending edit |
| No-op edits | Yes | Client skips when nothing changed locally; server returns `{ noop, seq }` without an event | `store.test.ts` noop |
| Edit the server already had (tab was behind) | Yes | Server no-op has no echo; the `seq` in the response settles the pending edit and drops its log row, so later server changes are not overridden | `reducer.test.ts` no-op ack; `actions.test.ts` PATCH no-op |
| Echo folded into a reconnect snapshot | Yes | The HTTP ack `seq` is at or below the snapshot `seq`, so the edit is settled instead of re-applied forever | `reducer.test.ts` snapshot ack |
| HTTP response lost after the server saved | Partially | Client marks it failed and rolls back; the SSE echo or the next snapshot restores the server value | Not directly tested |
| Two browser tabs | Yes | Shared SSE hub; log says "You" only for this tab's own edits, "A user" for other tabs | `activityText.test.ts`; two tabs manual |
| Pause state across tabs/reloads | Partially | Button reads the server pause state on mount; another tab's toggle is not pushed live | Manual |
| Mock title edit near 120 chars | Yes | Base title is cut so " (edited)" still fits `TITLE_MAX` | `store.test.ts` mock title limit |
| Invalid `MOCK_MIN_MS` / `MOCK_MAX_MS` | Yes | Non-numbers or negatives fall back to 2000/5000; max is raised to min | `store.test.ts` invalid env |
| `npm start` after `npm run dev` | Yes | Start script builds unless `.next/BUILD_ID` exists | Manual (`npm start` with a dev-only `.next`) |
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
- **E2E browser tests** — Nice to have, not required for this take-home. Unit + RTL already cover the shared-state contract (reducer, failure paths, SSE connect race, rapid edits). A Playwright two-tab smoke test would be the production next step to prove live sync end to end.

## 5. Assumptions

- Single Node process for the lifetime of a demo session.
- Five fixed team members are enough; no member CRUD.
- UUID v4-shaped ids from `crypto.randomUUID()`.
- “Unassigned” is `assigneeId: null`.

## 6. Code walkthrough

- **`src/state/reducer.ts`** — sole mutation path: snapshot, server events, optimistic create/update/delete, ack (settle by `seq`), rollback/markFailed, selection, connection, ensureDeleted.
- **`src/state/selectors.ts`** — memoized counts/groupings/ordered tasks/activity slice keyed on store references.
- **`src/hooks/useEventStream.ts`** — one live `EventSource`; snapshot + event handlers; reconnect on error, `seq` gap, or unparseable message; StrictMode-safe.
- **`src/state/actions.ts`** — optimistic dispatch then fetch; on success sends the response `seq` as an `ack`; field-aware failure handling; quiet 404.
- **`src/server/store.ts`** — in-memory authoritative store on `globalThis`; seq + activity + subscribe.
- **`src/server/eventStream.ts`** — SSE body per client: subscribe, snapshot, flush buffered newer events, heartbeat, cleanup on abort.
- **`src/server/mockUpdater.ts`** — injectable RNG/timer; random server-attributed changes.
- **`src/components/*`** — read only via selectors; editor keeps a local title draft.

## 7. Known weaknesses and next steps

- In-memory only; add persistence + shared bus before horizontal scale.
- LWW can overwrite concurrent field edits; consider per-field versions.
- Mock updater can delete user work; pause control mitigates demos.
- Pause state is not pushed live to other tabs; it is read on mount only.
- After a reload, the log shows your earlier edits as "A user" (`own` is not persisted).
- Nice to have next: Playwright two-tab E2E, structured logging, auth.

### Audit follow-up (fixed)

A review of the first version found these, all now fixed and tested:

- **SSE snapshot/subscribe race** — the stream read the snapshot before subscribing, so a write in between was lost for that client. Now subscribe-first with a buffer.
- **Older echo hid a newer edit** — the server copy from edit 1 overwrote still-pending edit 2 until its echo arrived. Now pending edits for the task are re-applied.
- **Untested failure paths** — 404 and network/validation failures in `actions.ts` had no test; `actions.test.ts` now covers them.
- **Unguarded `JSON.parse` on SSE data** — a bad message could stop the live handler. Now it triggers a reconnect.
- **Lean** — removed unused scaffold SVGs and `public/`, the one-line `mockTickHelper.ts`, and the unused `start:next` script.

A second review found these, all now fixed:

- **Pending edit stuck forever** — a server no-op, or an echo folded into a reconnect snapshot, never cleared the pending edit, so it was re-applied over newer server data and the tab drifted from the server. Responses now carry `seq` and the reducer settles on it.
- **`npm start` after `npm run dev`** — `.next` existed without a production build, so `next start` crashed. The start script now checks `.next/BUILD_ID`.
- **"You" for other tabs' edits** — every user entry said "You". Only this tab's own rows (`own`) do now; others say "A user".
- **Pause label local to the tab** — now read from `GET /api/mock/tick` on mount; fetch errors no longer go unhandled.
- **Mock title over 120 chars** and **NaN mock delay from a bad env value** — both bounded.
- **Missing test** for the hook's reconnect on a skipped `seq` — added.
- **Lean** — removed the unused `ServerStore.reset`, and `createBoardStore` now only takes a snapshot.
