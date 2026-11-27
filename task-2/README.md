# Task 2 — Shared-State Team Task Board

A Next.js 15 App Router board where five panels share one source of truth. User edits and mock-server updates both flow through a pure reducer so derived counts and groupings cannot drift.

**Runtime:** Node.js 20+

## How to run

```bash
cd task-2
npm start
```

`npm start` installs dependencies if `node_modules` is missing, builds if there is no production build (`.next/BUILD_ID`; a `.next` from `npm run dev` does not count), then serves on `PORT` (default `3000`).

```bash
npm run dev    # hot reload
npm test       # Vitest
npm run build  # production build only
```

## Configuration

| Env | Default | Meaning |
|---|---|---|
| `PORT` | `3000` | HTTP port |
| `MOCK_ENABLED` | `true` | Random server-side task mutations |
| `MOCK_MIN_MS` | `2000` | Min delay between mock ticks |
| `MOCK_MAX_MS` | `5000` | Max delay between mock ticks |
| `MOCK_SEED` | (time-based) | Seed for deterministic mock RNG |

See [`.env.example`](.env.example).

## State management

**Approach:** Zustand store factory + one pure `applyEvent` reducer. The store holds normalized `tasksById` / `order`, selection, activity, pending optimistic mutations, `lastSeq`, and connection status. Components never keep their own task copies. Counts and assignee groupings are memoized selectors over `tasksById`.

```text
User action ──► optimistic event ──► applyEvent ──► Zustand store ──► selectors ──► UI
                      │                                      ▲
                      └── REST ──► server store ──► SSE event ┘
Mock timer ───────────────────────► server store ──► SSE ─────┘
```

**Why this approach**
- One path for user and server changes keeps list, editor, summary, groupings, and activity atomic.
- Store factory + Provider avoids SSR/request and test state leaks (no module singleton).
- SSE is simpler than WebSockets for server→client fan-out in one Node process.
- Optimistic UI with `mutationId` echo reconciliation feels instant without double-applying.

**Derived data stays in sync** because it is never stored — only recomputed from `tasksById` when that reference changes.

**Optimistic reconciliation:** the client applies a tagged mutation immediately, POSTs/PATCHes/DELETEs, then on the SSE echo replaces the pending log row and server task version. Every successful mutation response also returns the server `seq` (`{ task, seq }`, `{ noop: true, seq }`, `{ seq }`); once `lastSeq` reaches it the pending edit is settled, even when no echo comes (server no-op, or the change was already in a reconnect snapshot). Failed requests roll back only fields that still hold the optimistic value. `seq` gaps force reconnect + snapshot; pending mutations are re-applied on top.

**Rejected alternatives:** Redux Toolkit (heavier for this size), Context + `useReducer` (more boilerplate, harder selective subscriptions), TanStack Query alone (great for server cache, weaker for multi-panel derived local consistency), polling (laggy), WebSocket library (unnecessary dependency).

## How to see it working

1. Open `http://localhost:3000` in two browser tabs.
2. Edit status/assignee in one tab — the other updates via SSE.
3. Watch the activity log and summary as the mock server mutates tasks (or click **Tick mock update** / pause).

## Implemented

- Five synchronized panels: task list, editor, summary, assignee view, activity log
- Add / update / delete with optimistic UI and field-aware rollback
- In-memory server store, REST API, SSE stream with snapshot + heartbeat
- Mock updater (env-configurable) + manual tick / pause controls
- `seq` ordering, gap detection, snapshot resync, pending re-apply
- Shared activity log (server ring buffer, client display)
- Vitest unit + RTL integration tests (incl. randomized selector invariants)
- Docker optional path (`output: 'standalone'`)

## Not implemented / left out

| Item | Why | Production approach |
|---|---|---|
| Persistence | Take-home scope; in-memory is enough to demo sync | Postgres/SQLite + migrations |
| Auth / multi-tenant | Not required | Session/JWT + board ACLs |
| Multi-instance SSE | Single Node process owns the hub | Redis pub/sub or managed realtime |
| Offline queue | Complexity vs. clarity | Outbox + retry with idempotency keys |
| Per-field conflict UI | Last-write-wins is explicit and testable | CRDT or field-level merge UX |
| E2E browser tests | Unit/RTL cover the shared-state contract | Playwright against `npm start` |

## Known limitations

- Data resets when the process restarts.
- Not serverless-compatible: store + SSE live in one long-lived Node process.
- Conflict policy is last-write-wins in server `seq` order.
- The mock pause button reads the server state on load; another tab's toggle is not pushed live.
- After a reload, your earlier edits show as "A user" in the log (which tab made a change is not stored).

## Docs

- [DECISIONS.md](DECISIONS.md)
- [AI_USAGE.md](AI_USAGE.md)

## Docker (optional)

```bash
docker compose up --build
```

Still prefer `npm start` for local review.
