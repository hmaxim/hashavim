# Task 2 Prompt: Shared-State Team Task Board

> **Navigation.** This is the task-specific prompt for **Task 2** (`TASK_FOLDER = task-2`). The shared rules (assignment rules, repository layout and isolation, formats of README / DECISIONS.md / AI_USAGE.md, shared checklist) are in the master prompt `AGENT_PROMPT.md` at the repository root. Read the master prompt first if you have not. Do not read or follow the Task 1 prompt.

You are a senior frontend/full-stack engineer. Build the complete "Shared-State Web Application" take-home described below. Work in phases. Prioritize a single source of truth, consistency of derived data, and clear, explainable state management over visual polish or feature breadth.

---

## Problem statement (verbatim requirements)

Build a web application where several different components display the same data. When the data changes, every component that shows it must update immediately and stay consistent.

**Scenario: a team task board**
- **Task list:** all tasks, with title, assignee, status and priority
- **Task editor:** edit the selected task
- **Summary panel:** counts by status and by assignee
- **Assignee view:** tasks grouped by person
- **Activity log:** a feed of recent changes

**Requirements**
1. Edit a task in any component (status in the list, assignee in the editor, and so on), and every other component reflects the change right away.
2. Add and delete tasks.
3. Data also changes on the application side, not only from the user. Simulate this with a mock server that randomly updates tasks every few seconds, using polling, WebSocket or Server-Sent Events. These changes must also reach every component.
4. Derived data (counts, groupings) must never be out of sync with the source data.
5. Tests for the shared-state logic.
6. A README explaining the state-management approach and why it was chosen.

React is preferred. Any state approach is fine, as long as it can be explained.

---

## Deliverables

All paths are relative to TASK_FOLDER (`task-2`). The shared documents (README.md, DECISIONS.md, AI_USAGE.md) follow the formats defined in the master prompt.

1. Source code and tests.
2. `README.md`: run instructions plus a clear "State management" section (approach and why).
3. `DECISIONS.md` and `AI_USAGE.md` (formats in the master prompt; Task 2 specifics below).
4. Optional, small: `Dockerfile`, `docker-compose.yml`, `.dockerignore` (see Phase 7).

The base assignment requires: source code and tests, a README with run instructions, and a short note on AI tool usage. A separate design document is NOT required for this task. DECISIONS.md and the Docker files are additions.

---

## Tech stack (keep unless there is a strong reason)

- Next.js 15 (App Router, using `await params` in dynamic route handlers), React 18+, TypeScript (strict). Node 20+.
- State: **Zustand**, using a store factory (`createBoardStore(initialState)`) with a Provider (no module-level singleton, so SSR requests never share state and every test gets a fresh store). All state transitions go through ONE pure reducer function; the Zustand store only holds state and calls the reducer.
- Mock server: Next.js Route Handlers in the same process (REST plus **Server-Sent Events**). No WebSocket library, no database, no auth. The server store is in memory.
- Tests: Vitest + React Testing Library + jsdom (+ `@testing-library/user-event`).
- Styling: plain CSS (CSS Modules or one global stylesheet). No UI component libraries, no Redux, no Tailwind required.
- Minimal dependencies. Validation helpers are small hand-written functions shared by client and server (no zod needed).
- ONE command to run: `npm start` (from a clean checkout it installs dependencies if `node_modules` is missing, builds if `.next` is missing, and starts on `PORT || 3000`). Also `npm run dev` and `npm test`.

---

## Phase 1: State design (write the "State management" section of the README first)

Use these principles. If implementation forces a change, update the README and record it in DECISIONS.md.

1. **Single source of truth.** One store holds `tasksById` (normalized), `order` (task ids in creation order), `selectedId`, the `activity` list, `pendingMutations`, `lastSeq` and `connection` status. No component keeps its own copy of tasks.
2. **Derived data is never stored.** Counts by status, counts by assignee (including "Unassigned"), and groupings by person are computed by pure selector functions from `tasksById`. They are memoized on the `tasksById` reference so they stay cheap and can never drift. Beware: a Zustand selector that returns a new object/array on every call causes render loops; subscribe to stable slices and compute through memoized selectors (or `useShallow`).
3. **One path for every change.** User actions and server events both become *events* applied by the same reducer (`applyEvent(state, event)`). No component mutates state any other way.
4. **Server is authoritative; the UI is optimistic.** A user action applies immediately to the store (tagged with a client-generated `mutationId`), then is sent to the server. The server applies it, assigns a global `seq`, and broadcasts the resulting event (including the `mutationId`) over SSE to all clients, including the originator. When the originator receives its own echo, it reconciles (replaces the task with the server's version, resolves the pending mutation) and does NOT apply it twice or duplicate the log entry.
5. **Ordering and idempotency.** Every server event has a monotonically increasing global `seq`. The client drops events with `seq <= lastSeq` (duplicates/stale) and treats a jump (`seq > lastSeq + 1`) as a gap: it reconnects, and the server answers with a fresh snapshot.
6. **Snapshot on connect.** On every (re)connect the SSE stream first sends a `snapshot` event (all tasks, the recent activity log, current `seq`). The client replaces its state with the snapshot and re-applies still-pending optimistic mutations on top.
7. **The activity log is shared state too.** The server owns the log (ring buffer of the last 50 entries). Each event carries its log entry, and the snapshot carries the whole log, so the log survives reloads and is identical across tabs. For the user's own optimistic change the client adds a `pending` entry keyed by `mutationId`; the echoed server entry replaces it.
8. **Atomicity.** A task change and its log entry are applied in the same reducer step, so the list, editor, summary, groupings and log can never show different versions of the data.

### Data model (shared types in `src/lib`)

- `Status = 'todo' | 'in_progress' | 'in_review' | 'done'`
- `Priority = 'low' | 'medium' | 'high'`
- `Member = { id: string; name: string }`: a fixed list of 5 team members (constant, shared by client and server).
- `Task = { id: string; title: string; assigneeId: string | null; status: Status; priority: Priority; createdAt: string; updatedAt: string }` (`id` is a client- or server-generated UUID; for user-created tasks the client generates it so no temp-id remapping is needed, and the server validates format and uniqueness).
- `TaskPatch = Partial<Pick<Task, 'title' | 'assigneeId' | 'status' | 'priority'>>`
- `ActivityEntry = { id: string; at: string; source: 'user' | 'server'; type: 'created' | 'updated' | 'deleted'; taskId: string; taskTitle: string /* snapshot, needed after deletes */; changes: { field: string; from: unknown; to: unknown }[]; mutationId?: string; pending?: boolean }`
- `TaskEvent = { seq: number; type: 'task.created' | 'task.updated' | 'task.deleted'; task?: Task /* after-state for created/updated */; taskId: string; mutationId?: string; activity: ActivityEntry }`

---

## Phase 2: Mock server (Next.js Route Handlers)

- In-memory server store kept on `globalThis` (so it survives HMR and is shared by all route handlers in the single Node process). Route handlers use `export const runtime = 'nodejs'` and `export const dynamic = 'force-dynamic'`.
- The server store exposes: `getSnapshot()`, `createTask()`, `patchTask()`, `deleteTask()`, `subscribe(listener)`. It assigns `seq`, builds the activity entry, appends it to the ring buffer, and notifies subscribers, all synchronously in one step.
- Endpoints:
  - `GET /api/tasks`: `{ tasks, activity, seq }`.
  - `POST /api/tasks`: body `{ id, title, assigneeId, status, priority, mutationId }`. Returns 201. 400 on validation errors, 409 on duplicate id.
  - `PATCH /api/tasks/:id`: body `{ patch, mutationId }`. 200 on success, 404 if the task is gone, 400 on validation errors. A no-op patch (values identical) returns 200 and emits no event and no log entry.
  - `DELETE /api/tasks/:id?mutationId=...`: 204 on success, 404 if already gone.
  - `GET /api/events`: SSE stream. First message is the `snapshot`; then one `event` per change; a heartbeat comment every ~15 s; unsubscribe on `request.signal` abort.
- Validation: title trimmed, 1-120 chars; `assigneeId` is a known member id or `null`; `status`/`priority` are valid enum values; patch has at least one known field.
- **Mock updater:** a timer that, every random 2-5 s, performs a random change attributed to `source: 'server'`: mostly status changes, sometimes assignee/priority/title changes, occasionally add or delete (keep the task count between 5 and 30). Start it lazily and exactly once (guard flag on `globalThis`). Config via env: `MOCK_ENABLED`, `MOCK_MIN_MS`, `MOCK_MAX_MS`, `MOCK_SEED`. The RNG and the timer are injectable so tests are deterministic.
- Seed 8-10 realistic tasks spread across statuses, priorities and members, with one or two unassigned.
- Optional, small (for reviewers/demo): `POST /api/mock/tick` triggers one random update immediately; a "pause/resume server updates" toggle in the UI.

---

## Phase 3: Client app

- `app/page.tsx` is a Server Component with `export const dynamic = 'force-dynamic'` (so Next.js never statically caches the initial snapshot at build time): it reads the initial snapshot directly from the server store and passes it to a client `<Board initialSnapshot>`. The store is created once in a Provider (`useRef`) from that snapshot, so there is no loading flash and no refetch on first paint.
- `useEventStream` hook: opens `EventSource('/api/events')`, dispatches `snapshot` and `event` messages into the store, sets `connection` to `connected` / `reconnecting`, closes on unmount (must be safe under React StrictMode double-mount), and reconnects on gap detection.
- Actions (`addTask`, `updateTask`, `deleteTask`, `selectTask`): each applies the optimistic event, then calls the API. On a network error or non-2xx response, roll back **only the fields that still hold the optimistic value** (so a newer server change is never clobbered), mark the pending log entry as failed or remove it, and show a small inline error. A 404 on PATCH/DELETE means the task was already deleted elsewhere; treat it as resolved without an error.
- Components (all read from the same store through selectors; none holds a copy of the data):
  - `TaskList`: rows with title, assignee `<select>`, status `<select>`, priority `<select>`, delete button; click a row to select it; an "Add task" form (title required) at the top. Selected row highlighted.
  - `TaskEditor`: edits the selected task. Selects (assignee, status, priority) apply immediately. The title input keeps a local draft and commits on blur/Enter; if the same task's title changes externally while the user is typing, keep the draft and show a small "changed elsewhere" notice instead of overwriting it. Empty state when nothing is selected or the selected task was deleted (the reducer clears `selectedId` atomically on delete). Delete button.
  - `SummaryPanel`: total, counts per status (all statuses shown, including zeros), counts per assignee including "Unassigned".
  - `AssigneeView`: tasks grouped by person (including "Unassigned" and members with no tasks, shown with an empty message); each item shows title, status, priority; clicking selects it.
  - `ActivityLog`: newest first, last 20 shown, readable sentences (for example "You changed status of 'X' from todo to done", "Server assigned 'Y' to Ben"), `pending` entries visibly marked, `aria-live="polite"`.
  - `ConnectionStatus`: small indicator (connected / reconnecting).
- Hydration safety: no `Date.now()`/random values in the first render; format timestamps on the client only (after mount) to avoid hydration mismatches.
- Layout: simple responsive CSS grid, all five components visible at once on desktop. Basic accessibility: labelled controls, keyboard-operable selects and buttons, visible focus.
- Performance: components wrapped in `memo`, list rows keyed by id, selectors memoized so a change to one task does not re-render unrelated components unnecessarily.

---

## Phase 4: Edge cases to handle (document each in DECISIONS.md, test what is implemented)

- User edit and server update hit the same task at nearly the same time (converge to the server's order; no flicker back to a stale value).
- Echo of the user's own change arrives from the server (no double apply, no duplicate log entry).
- Duplicate or out-of-order SSE events; `seq` gap; reconnect after a dropped connection (snapshot resync, pending mutations preserved).
- Optimistic request fails (rollback only still-optimistic fields, never clobber newer server data).
- Task deleted by the server while selected or being edited (editor clears with a notice, no crash).
- Task deleted while the user has a pending PATCH for it (404 handled quietly).
- Unassigned tasks and unknown/removed assignee ids in counts and groupings.
- Empty board (no tasks): every component renders a sensible empty state; counts are zeros.
- Add task with empty or whitespace title, over-long title, duplicate id (validation on both client and server).
- Rapid consecutive edits to the same task (each is a separate mutation; final state is the last one).
- No-op edits (same value selected): no event, no log entry.
- Two browser tabs open: both converge via SSE, including each other's edits.
- React StrictMode double effects: exactly one live EventSource.
- Hydration: server-rendered HTML matches the first client render.
- Server restart or in-memory reset while clients are connected (reconnect yields a new snapshot; document that data is not persisted).
- Activity log growth (bounded on both server and client).

---

## Phase 5: Tests (Vitest + React Testing Library)

Write tests for the shared-state logic; every edge case you claim to handle must have a test. Required:

**Reducer and selectors (pure unit tests)**
- `applyEvent` for created / updated / deleted; the log entry is added in the same step.
- Idempotency: replaying the same event (same `seq`) changes nothing; stale `seq` is dropped; a gap is flagged.
- Echo reconciliation: a server event carrying a pending `mutationId` resolves it without a duplicate log entry.
- Rollback restores only still-optimistic fields.
- Deleting the selected task clears `selectedId`.
- `selectCountsByStatus`, `selectCountsByAssignee` (including Unassigned and zero counts), `selectGroupedByAssignee`, with empty and mixed data.
- **Invariants (randomized):** apply a long random sequence of user and server events (seeded RNG, no extra library needed), then assert that sum of status counts == number of tasks, sum of assignee counts == number of tasks, every task appears in exactly one group, and derived values equal a from-scratch recomputation.

**Component integration (RTL, whole board rendered with a real store)**
- Change status in the list -> editor, summary, assignee view and activity log all update.
- Change assignee in the editor -> list row, summary and grouping update.
- Add a task -> appears in list, counts, grouping, log. Delete a task -> disappears everywhere; editor clears if it was selected.
- A server event injected through a fake `EventSource` updates every component.
- Reconnect: a fake `EventSource` error then a new snapshot -> state resynced, pending mutation preserved.
- Title draft is not overwritten by an external title change while typing.

**Server store and mock updater (unit tests)**
- `seq` is strictly increasing; validation errors; no-op patch emits nothing; 404 / 409 cases; activity ring buffer is bounded; the mock updater is deterministic with a seeded RNG and a fake timer; subscribers are removed on unsubscribe.

Tests must be deterministic (no real timers or network; inject clock/RNG/EventSource).

---

## Phase 6: DECISIONS.md (Task 2 specifics)

Create it in the format defined in the master prompt (verbatim statement, then the standard sections). For Task 2:

- **Decision log** must cover at least: repository layout (self-contained task folder), Next.js vs Vite + separate server, state library (Zustand + pure reducer vs Redux Toolkit vs Context + useReducer vs TanStack Query), normalized store, derived data via selectors, SSE vs WebSocket vs polling, server-authoritative with optimistic updates, `seq` + snapshot-on-connect resync, server-owned activity log, client-generated task ids, conflict policy (last write wins in server order), in-memory storage.
- **Edge cases** table: every edge case from Phase 4, with Handled? (Yes / Partially / No), how, and the covering test.
- **Skipped or simplified** should consider: persistence, auth, per-field merge/conflict UI, offline queue, multi-instance server (needs a shared bus such as Redis), end-to-end browser tests.
- **Code walkthrough** must cover: the reducer, selectors, the event stream hook, optimistic/rollback logic, and the server store.

---

## Phase 7: README.md (and optional Docker)

README must include (the common README contents are in the master prompt):
- How to run (`npm start`), how to develop (`npm run dev`), how to test (`npm test`), the Node version, and env options (`PORT`, `MOCK_ENABLED`, `MOCK_MIN_MS`, `MOCK_MAX_MS`, `MOCK_SEED`).
- **State management** section (written in Phase 1): the approach, a small Mermaid or ASCII diagram of the data flow (user action / server event -> reducer -> store -> selectors -> components), why this approach, how derived data is guaranteed to stay in sync, how optimistic updates and server events are reconciled, and the main alternatives that were rejected.
- A "How to see it working" note (open two tabs, edit in one, watch the other; watch the mock server updates and the activity log).
- A clear **Implemented** section and a clear **Not implemented / left out** section (with the reason and how it would be done in production).
- Known limitations (in-memory data resets on restart; a single server process; the app is not serverless-compatible because the store and SSE live in one Node process).
- Links to `DECISIONS.md` and `AI_USAGE.md`.

Optional Docker (keep it small; `npm start` stays the primary path):
- Multi-stage `Dockerfile` (Next.js `output: 'standalone'`, non-root user, exec-form CMD so SIGTERM is received), `docker-compose.yml` with env vars and the port mapping, `.dockerignore` (`node_modules`, `.next`, `.git`, `coverage`). Run exactly one container (the in-memory store and the SSE hub live in one process). Document `docker compose up --build`.

---

## Working rules (Task 2 specifics)

The shared working rules are in the master prompt. In addition:

- Write the "State management" section of the README first, then implement it.
- Keep the code small, readable and layered: `src/lib` (types, validation, constants), `src/state` (reducer, selectors, store factory, actions), `src/server` (server store, mock updater), `src/components`, `app/` (pages and route handlers). Strict TypeScript, no `any` in the reducer, selectors or server store.
- No component may read tasks from anywhere except the store, and no derived data may be stored in state.
- Verify from a clean checkout of the whole repository, from inside TASK_FOLDER (no `node_modules`): `npm start` works and `npm test` passes. Open the app in two browser tabs and confirm that edits and mock-server updates reach all five components in both tabs.

---

## Task 2 checklist (in addition to the shared checklist in the master prompt)

- [ ] `npm test` passes, including the randomized invariant test for derived data.
- [ ] README has run instructions, a "State management" section explaining the approach and why, "Implemented" and "Not implemented / left out" sections.
- [ ] All five components update together for: edit in list, edit in editor, add, delete, and mock-server updates, in two tabs.
- [ ] The edge-case table in DECISIONS.md matches the tests.