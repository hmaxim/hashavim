# Task 1 Prompt: AI Usage Metering & Quota System

> **Navigation.** This is the task-specific prompt for **Task 1** (`TASK_FOLDER = task-1`). The shared rules (assignment rules, repository layout and isolation, formats of README / DECISIONS.md / AI_USAGE.md, shared checklist) are in the master prompt `AGENT_PROMPT.md` at the repository root. Read the master prompt first if you have not. Do not read or follow the Task 2 prompt.

You are a senior backend engineer. Build the complete "AI Usage Metering & Quota System" take-home described below. Work in phases and do not skip the design phase. Prioritize correctness under concurrency, clear decisions, and tests for edge cases over feature breadth.

---

## Problem statement

We run an AI application. Every request a user makes to the AI API uses one credit. Every credit used must be stored as evidence of usage, because it may be used for billing, audits, and dispute resolution. Each user may make at most X requests within a period, and X is configurable.

**Part A: Technical design.** A short design document of 2-4 pages (diagrams welcome) covering: architecture, data model, quota enforcement, edge cases, failure handling, scaling, trade-offs.

**Part B: Implementation.** A working version that runs locally. It does not need to include everything in the design; state clearly what is implemented and what is left out.

Minimum for Part B:
- An endpoint that receives an AI request for a user. The AI call is simulated with a random delay and occasional failure.
- Enforce the per-user limit.
- Record every usage as evidence.
- An endpoint that returns a user's current usage and remaining credits.
- Automated tests, especially for edge cases.
- A README: how to run it, what is implemented, what is missing.

Any language or framework. Local storage only (SQLite, a file, or in-memory). The solution must start with one command.

---

## Deliverables

All paths are relative to TASK_FOLDER (`task-1`). The shared documents (README.md, DECISIONS.md, AI_USAGE.md) follow the formats defined in the master prompt.

1. `DESIGN.md`: the design document (2-4 pages, Mermaid diagrams). Required for Task 1 only.
2. A working implementation that runs locally, and automated tests.
3. `README.md`, `DECISIONS.md`, `AI_USAGE.md` (formats in the master prompt; Task 1 specifics below).
4. `Dockerfile`, `docker-compose.yml`, `.dockerignore` (an additional way to run the app).

The base assignment requires: source code and tests, a README with run instructions, the design document in Markdown, and a short note on AI tool usage. DECISIONS.md and the Docker files are additions.

---

## Tech stack (keep unless there is a strong reason)

- Node.js 20+ (LTS), TypeScript, NestJS (Express adapter), SQLite via `better-sqlite3`.
- Validation: class-validator / class-transformer DTOs with the global ValidationPipe. Config: `@nestjs/config` with schema validation (fail fast on bad config).
- Tests: Jest + supertest. Local storage only. No external services (no Redis, no database server).
- Docker is an ADDITIONAL way to run the app, never a requirement: the app must also run directly with `npm start`.
- ONE command to start locally: `npm start` (installs dependencies if `node_modules` is missing, builds if needed, and starts the server on a configurable `PORT`).
- ONE command to start with Docker: `docker compose up --build`.
- ONE command to test: `npm test`.
- Do not use Next.js and do not add any UI.

---

## Phase 1: DESIGN.md (must cover all 7 sections)

1. **Architecture.** Components (HTTP controller, quota service, usage ledger repository, AI provider client, config, sweeper) and the request flow, with a Mermaid sequence diagram.
2. **Data model.** What is stored per usage and why. At minimum: `usage_id`, `user_id`, `idempotency_key`, `request_id`, `period_id`, `status`, `credits` (cost), `limit_at_time_of_use` (config snapshot), `created_at` / `settled_at` (server time, UTC), AI outcome (success/failure/timeout, latency, error code), and an optional request hash. Explain how each field serves billing, audit, or dispute resolution.
3. **Quota enforcement.** Use the reserve -> execute -> settle pattern:
   - RESERVE: in ONE atomic DB transaction, check `count < limit`, increment the counter, and append a `RESERVED` ledger row. No check-then-act race.
   - EXECUTE: call the (simulated) AI outside the DB transaction.
   - SETTLE: on success, append `COMMITTED`. On failure/timeout, append `RELEASED` (credit returned, but the attempt is still recorded as evidence). Prevent double-settlement (e.g., a late AI completion arriving after a timeout release) via a partial unique index (`UNIQUE(reservation_id) WHERE status IN ('COMMITTED', 'RELEASED')`) and an idempotent check inside the settle transaction so a terminal reservation is never settled or refunded twice.
   - The ledger is append-only (state changes are new events, and SQLite triggers block UPDATE/DELETE). The counter is a derived, rebuildable cache; a reconciliation function must verify that each period's counter equals `count(COMMITTED) + count(non-expired RESERVED)` in the ledger (ignoring `RELEASED` and `REJECTED_QUOTA` rows, which carry `credits = 0`) and report drift.
4. **Edge cases.** Find as many as you can and explain the handling of each. Must include at least:
   - Concurrent requests at the limit boundary (N parallel requests when 1 credit remains: exactly 1 succeeds)
   - Client retries / duplicate submissions -> `Idempotency-Key`; the same key returns the original result and never double-charges
   - Same idempotency key with a different payload -> 409/422
   - AI call fails -> credit released, evidence kept
   - AI call is slow / times out -> timeout, release; a late result must not be double-settled
   - Server crashes between RESERVE and SETTLE -> stuck RESERVED rows expire after a TTL (lazy expiry on quota check + a sweeper) and are released, with a marker saying why
   - Period boundaries (fixed UTC calendar window vs rolling window: pick one, justify it, and store `period_id` on every record); a request straddling the boundary is billed to the period in which it was reserved
   - Limit X changed mid-period (raise/lower): the new limit applies immediately; lowering below current usage blocks new requests but never deletes history; the limit snapshot is stored per record
   - Per-user limit overrides vs a global default
   - Unknown/new user (auto-create vs reject; decide and document), invalid `user_id`, missing/empty payload
   - Clock skew / multiple instances: use server/DB time only, never client time
   - Limit = 0, very large limit, negative or non-integer config -> validation
   - Idempotency key reuse across periods or users
   - Usage queried while requests are in flight (RESERVED credits count as used, and the usage endpoint shows pending separately)
   - Ledger tampering attempts (UPDATE/DELETE blocked) and an optional hash-chain for tamper evidence
   - Refund semantics: why failed calls are not billed but are still evidenced
   - Rate-limit/abuse vs quota (mention, do not necessarily implement)
5. **Failure handling.** DB down/locked/slow (fail closed: reject with 503 rather than serve unmetered AI calls; explain why), AI provider down/slow (timeouts, no retries that could double-charge, optional circuit breaker), settle-write failure after an AI success (durable retry / outbox / recovery sweep so evidence is never lost), partial failures, graceful shutdown (drain in-flight requests, settle or leave RESERVED for the sweeper).
6. **Scaling.** Many users and many instances: stateless API instances; partition/shard by `user_id`; per-user atomic counters (e.g. Postgres `UPDATE ... WHERE used < limit RETURNING`, or Redis Lua for the hot path with the ledger as the source of truth); the ledger as an append-only table partitioned by time/user (or a stream such as Kafka feeding cold storage); hot-user contention; read replicas for the usage endpoint; counter rebuild from the ledger; multi-region considerations.
7. **Trade-offs.** Chosen vs rejected, with reasons: reserve/settle vs charge-after (overshoot risk) vs charge-before-without-refund (unfair on failure); a DB transaction vs a distributed lock; a counter cache vs `COUNT(*)` on every request; fixed vs rolling window; fail-closed vs fail-open; synchronous vs async ledger writes; SQLite (local only) vs Postgres/Redis in production; NestJS vs Next.js vs plain Node.

---

## Phase 2: Implementation (minimum)

- `POST /v1/ai/requests`: body with `userId` and `prompt` (header `Idempotency-Key` optional — auto-generated UUID on the server if omitted, honored and deduplicated when provided). It reserves a credit, calls a simulated AI (random delay, configurable, e.g. 50-500 ms; configurable failure rate, e.g. 15%; hard timeout), settles idempotently (guarded against late double-settlement via a partial unique index on terminal status per `reservation_id`), and returns the result plus usage info. Return 429 when the quota is exceeded (with remaining/reset info), 503 when storage is unavailable.
- `GET /v1/users/:userId/usage`: returns limit, used (committed), pending (reserved), remaining, period start/end, and optionally the last N ledger entries.
- Admin endpoint (or config table) for per-user limit overrides.
- Enforce the per-user limit atomically: `better-sqlite3` transaction with `BEGIN IMMEDIATE`, WAL mode, and `busy_timeout`. These transactions are synchronous and must never span an `await`; the AI call happens between two separate transactions.
- Record EVERY attempt as evidence in an append-only usage ledger, including failed, timed-out, and rejected-by-quota attempts (as a distinct status).
- Configuration via env vars: `DEFAULT_LIMIT` (X), `PERIOD` (daily/monthly), `AI_FAILURE_RATE`, `AI_MIN_DELAY_MS`, `AI_MAX_DELAY_MS`, `AI_TIMEOUT_MS`, `RESERVATION_TTL_SECONDS`, `DB_PATH`, `PORT`. Validate all of it at startup.
- Provide the clock (`Clock`) and the AI client (`AiProvider`) as injectable NestJS providers behind interfaces, so tests override them with a fake clock and a controllable AI (outcome and delay).
- Include a `reconcile` function plus an npm script (`npm run reconcile`) that checks each period's counter against `count(COMMITTED) + count(non-expired RESERVED)` in the ledger.
- Structured JSON logging with a `request_id` on every request (middleware/interceptor).
- Suggested layout: `src/api` (controllers, DTOs), `src/quota` (service), `src/ledger` (repository, migrations, triggers), `src/ai` (provider + simulator), `src/config`, `src/common` (filters, interceptors, clock).

---

## Phase 2b: Docker packaging

- `Dockerfile`: multi-stage build on a `node:20-alpine` or `node:20-slim` base.
  - Build stage: install all dependencies (including native build tools if `better-sqlite3` needs them) and compile TypeScript.
  - Runtime stage: copy only the compiled output and production dependencies, run as a non-root user, set `NODE_ENV=production`, `EXPOSE` the PORT, add a `HEALTHCHECK`, and use `CMD ["node", "dist/main.js"]`.
  - Use exec-form CMD so the process receives SIGTERM and the graceful-shutdown hooks run.
- `docker-compose.yml`: one service with all config via environment variables (`DEFAULT_LIMIT`, `PERIOD`, `AI_FAILURE_RATE`, `AI_MIN_DELAY_MS`, `AI_MAX_DELAY_MS`, `AI_TIMEOUT_MS`, `RESERVATION_TTL_SECONDS`, `DB_PATH`, `PORT`), port mapping, and a named volume mounted at the DB directory so the SQLite ledger survives container restarts. Include a `stop_grace_period` long enough for in-flight requests to drain.
- `.dockerignore`: exclude `node_modules`, `dist`, `.git`, `*.db`, `*.db-wal`, `*.db-shm`, and test artifacts.
- Do not bake the SQLite file into the image. `DB_PATH` must point into the mounted volume.
- Verify the image builds and the container starts, then check `GET /v1/users/:userId/usage` and a `POST /v1/ai/requests` against the running container.
- Note the limitation in DESIGN.md and the README: with SQLite, run exactly ONE container replica (scaling out requires Postgres/Redis, as described in the scaling section).

---

## Phase 3: Tests (Jest + supertest)

Write tests for every edge case you listed that is implemented. Required:

- Limit enforced: the (X+1)th request gets 429.
- Concurrency: with limit=5 and 50 parallel HTTP requests (`Promise.all`), exactly 5 are committed, the rest get 429, and the ledger/counter agree. Also add a multi-process test (spawn 2-3 server processes on the same SQLite file) to prove atomicity across instances, or clearly state it as a known gap.
- Idempotency: replay returns the same response with no extra credit used; the same key with a different payload is rejected.
- AI failure -> credit released and still recorded; remaining is restored.
- AI timeout -> released; a late completion does not double-settle.
- Crash simulation: a stale RESERVED row past its TTL is expired and the credit is returned.
- Period rollover with the fake clock: usage resets, old records are retained, `period_id` is correct.
- Limit changes mid-period (raise and lower), plus per-user override.
- Usage endpoint shows used / pending / remaining correctly, including while a request is in flight.
- Ledger immutability: UPDATE/DELETE fails.
- Reconciliation detects an injected counter drift.
- Input validation (missing user, bad payload, bad config).

---

## Phase 4: README.md (Task 1 specifics)

Follow the common README contents in the master prompt, and also include:

- How to run with Docker (`docker compose up --build`), where the data volume lives and how to reset it, how env vars map to compose, and the single-replica limitation.
- An example `curl` for each endpoint.
- The config options (env vars) with defaults.
- Key design decisions: links to DESIGN.md, DECISIONS.md and AI_USAGE.md.

---

## Phase 5: DECISIONS.md (Task 1 specifics)

Create it in the format defined in the master prompt (verbatim statement, then the standard sections). For Task 1:

- **Decision log** must cover at least: repository layout (self-contained task folder, no shared workspace), framework (NestJS), SQLite driver, reserve/settle pattern, append-only ledger with a derived counter, fixed UTC window vs rolling, idempotency design, fail-closed on storage errors, no retries on AI failure, unknown-user handling, how limit changes are applied, TTL-based expiry of stuck reservations, Docker as an optional extra.
- **Edge cases** table: every edge case from Phase 1 section 4, with Handled? (Yes / Partially / No), how, and the covering test.
- **Code walkthrough** must cover: the reserve transaction, settle logic, idempotency handling, the sweeper, and reconcile.

---

## Working rules (Task 1 specifics)

The shared working rules are in the master prompt. In addition:

- Write DESIGN.md first, then implement it. If implementation forces a design change, update the doc and record the change in DECISIONS.md.
- Keep the code small, readable, and layered. No over-engineering; avoid unneeded dependencies. Strict TypeScript, no `any` in core logic.
- Never charge a credit without a ledger row, and never leave a ledger row without a consistent counter state: both change in the same transaction.
- Verify both start paths from a clean checkout of the whole repository, from inside TASK_FOLDER (no `node_modules`): `npm start` and `docker compose up --build`. Confirm that `better-sqlite3` installs without manual steps, that the ledger persists across `docker compose down` and `up` (volume), and that SIGTERM triggers graceful shutdown.
- Run the tests and the one-command start yourself, and fix any failures before declaring done.

---

## Task 1 checklist (in addition to the shared checklist in the master prompt)

- [ ] `npm test` passes; concurrency, idempotency, timeout, crash-recovery, period-rollover, limit-change, immutability and reconcile tests are present.
- [ ] `DESIGN.md` (Markdown) covers all 7 sections and is 2-4 pages.
- [ ] Both start paths work from a clean checkout; the ledger persists across container restarts.
- [ ] README has run instructions (`npm start`, `docker compose up --build`), an example curl per endpoint, "Implemented" and "Not implemented / left out" sections.
- [ ] The edge-case table in DECISIONS.md matches the tests.