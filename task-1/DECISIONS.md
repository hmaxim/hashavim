# Decisions — Task 1 Usage Metering

> **AI tools are allowed and encouraged. You must be able to explain every line you submit.**
> **Clear decisions and edge-case handling matter more than completeness. If you skip something, say so and explain why.**

## 1. AI usage

Cursor Agent implemented this task from the Task 1 skill: design doc, NestJS/SQLite service, tests, Docker, and docs. Generated code was reviewed and corrected: not throwing inside the reserve transaction, pending counts excluding settled reservations, and a follow-up audit that fixed in-flight idempotency replays, a non-atomic idempotency cache write, and an unauthenticated admin route. A second audit fixed a false drift alarm in reconcile, a reconcile CLI that silently created an empty DB, client-chosen request ids in the ledger, and an inaccurate "retry heals settle failure" claim. See [AI_USAGE.md](AI_USAGE.md).

## 2. Decision log

| Decision | Alternatives considered | Why this choice | Consequence/risk |
| --- | --- | --- | --- |
| Self-contained `task-1/` folder | Root monorepo / workspaces | Assignment isolation; clean clone runs from folder | Duplicate tooling if Task 2 also needs Node |
| NestJS | Plain Node, Next.js | DI for Clock/AI fakes; no UI | Slightly heavier than a tiny HTTP server |
| `better-sqlite3` | sql.js, async sqlite | Sync TX + `BEGIN IMMEDIATE` fits reserve/settle | Native addon; needs build tools in Docker |
| Reserve → execute → settle | Charge-after; charge-before no refund | No overshoot; fair on AI failure | Two TX + TTL complexity |
| Append-only ledger + derived counter | Mutable balance row only | Audit/billing evidence; rebuildable cache | Pending must exclude terminal siblings |
| Fixed UTC window (`daily`/`monthly`) | Rolling window | Simple `period_id`; clear bills | Cliff at midnight UTC |
| Idempotency via unique reserve + response cache | Only HTTP layer cache | Survives process restart | Global per-user key (cross-period replay) |
| Same key while first call is in flight → 409 | Wait for the first call; return a partial "replay" body | Never return a fake result; client retries after a short delay | Client must handle 409 and retry |
| Replay body written in the settle transaction | Settle first, cache the body in a second write | A crash between two writes left a billed call with no replayable result | `settle` takes a `buildResponse` callback |
| Fail-closed on storage errors | Fail-open (serve AI anyway) | Never unmetered usage | Availability dips when DB locked |
| No AI retries | Automatic retry with backoff | Avoid double-charge / ambiguous settle | Transient AI blips surface as released |
| Auto-create unknown users | Reject unknown | Fewer moving parts for demo | No explicit user registry |
| Limit changes apply immediately | Next-period only | Matches “X is configurable” intent | Lowering can block mid-period |
| Admin route needs `ADMIN_TOKEN` (header `x-admin-token`); disabled when unset | No auth; full user/role auth | Smallest guard that stops anyone from changing limits; constant-time compare | One shared secret, no per-admin audit |
| TTL + sweeper for stuck RESERVED | Manual admin only | Crash between reserve and settle recovers | Brief over-hold of credit until TTL |
| Startup rejects `RESERVATION_TTL_SECONDS` ≤ `AI_TIMEOUT_MS` | Document it only | Otherwise the sweeper releases a live call and its success is never billed | One more config rule to know |
| `request_id` always server-generated; client `x-request-id` only logged as `client_request_id` | Trust the client header | It is stored as ledger evidence; a client could collide or forge it | Clients correlate via the returned `x-request-id` header |
| Reconcile compares the counter with `COMMITTED` + **all** open `RESERVED` (expired or not) | Only non-expired `RESERVED` | The counter keeps an expired credit until the expiry path appends `RELEASED`; counting only live ones reported drift after every crash | Reconcile does not tell you a reservation is stale; `/usage` and the sweeper do |
| Reconcile CLI exits 2 if `DB_PATH` does not exist | Open (and create) the file | Checking a wrong path must not report `ok` on an empty DB | Must point at the real DB path, even in Docker |
| TTL-released replay body has the normal response shape (`ai: null`, `reason: ttl_expired`) | Minimal `{status, reason}` blob | One response shape for clients | AI text from a late answer is never returned |
| Test fakes (`FakeClock`, `ControllableAiProvider`) live in `test/fakes.ts` | Keep them in `src/` | Production build only ships production code | None |
| Node `crypto.randomUUID()` for ids | `uuid` package | Built into Node 20; one dependency fewer | None |
| Stress suite separate from `npm test` (`npm run test:stress`) | Always run heavy load in CI | Keeps the default suite fast; still proves quota under burst / sustained / multi-user load | Easy to forget to run stress before submit |
| Docker as optional extra | Docker-only | `npm start` remains primary | Two run paths to maintain |

## 3. Edge cases

| Edge case | Handled? | How / why skipped | Test |
| --- | --- | --- | --- |
| Concurrent at limit boundary | Yes | `BEGIN IMMEDIATE` serialize | concurrency + multi-process |
| Large burst over the limit (500 vs limit 50) | Yes | Same TX path; exactly `limit` commits; reconcile clean | stress burst |
| Sustained mixed POST+GET across many users | Yes | Per-user counters; no cross-user bleed; reconcile clean | stress sustained waves |
| Many parallel retries of the same idempotency keys | Yes | One reservation per key; AI called once per key | stress idempotent |
| Many users each racing their last credit | Yes | Each user gets exactly one commit under parallel storms | stress last-credit race |
| Client retries / Idempotency-Key | Yes | Index + cached response | idempotency replay |
| Same key different payload | Yes | Hash compare → 409 | idempotency 409 |
| Same key while first call is in flight | Yes | Index row not terminal → 409 "still in progress"; after settle, replay returns the stored result and the AI is called once | in-flight duplicate 409 |
| Crash after settle, before cache write | Yes | Replay body stored in the same transaction as the settle row | covered by replay after in-flight test |
| AI failure | Yes | `RELEASED`, counter −1 | AI failure test |
| AI timeout + late settle | Yes | Terminal check in settle TX; late settle returns `settled: false` | timeout + late settle |
| TTL shorter than AI timeout | Yes | Rejected at startup | config.spec TTL rule |
| Crash reserve→settle | Yes | TTL lazy + sweeper | stale RESERVED test |
| Reconcile run after a crash, before the sweeper | Yes | Counts all open `RESERVED`, so an expired-but-unswept credit is not drift | reconcile no drift for expired reservation |
| Reconcile CLI pointed at a missing DB | Yes | Exits 2, creates nothing | reconcile-cli.e2e-spec |
| AI answer arrives after TTL release | Yes | Settle sees the terminal row → not billed; replay of the key returns `released` / `ttl_expired` with `ai: null` | AI answer after TTL release |
| Settle write fails after AI success | Partially | Client gets 503, call is not billed. Same key returns 409 until TTL, then the `ttl_expired` body; the client must retry with a **new** key to get an answer | — (needs fault injection inside settle) |
| Client sends its own `x-request-id` | Yes | Ignored for evidence; server id stored and returned | request_id server-generated |
| Period boundaries | Yes | Fixed UTC; bill reserve period | period rollover |
| Limit change mid-period | Yes | Override table; snapshot on row | raise/lower + override |
| Per-user override | Yes | `PUT .../limit` with admin token | limit override test |
| Admin route without / with wrong token | Yes | 403; 403 when `ADMIN_TOKEN` unset | admin token test |
| Unknown user | Yes | Auto-create on first reserve | implicit in all tests |
| Invalid user/payload | Yes | class-validator → 400 | invalid payloads |
| DB locked / unavailable | Yes | `SQLITE_BUSY` → 503 on AI requests, usage reads and limit changes; AI is not called | 503 when locked |
| Clock skew / multi-instance | Partially | Server Clock only; multi-process same DB tested; no multi-region | multi-process |
| Limit 0 / bad config | Yes | Validation at startup + runtime | limit=0 + config.spec |
| Idempotency across periods | Yes | Unique per user globally; replay | replay test |
| Usage while in flight | Yes | Pending = open RESERVED | in-flight pending |
| Ledger tampering | Partially | Triggers block UPDATE/DELETE; no hash-chain | immutability test |
| Refund semantics | Yes | Failure → RELEASED evidence | AI failure test |
| Rate-limit vs quota | No | Mentioned only; out of scope | — |

## 4. Skipped or simplified, and why

- **Hash-chain:** not needed to prove append-only with triggers; add later for stronger dispute evidence.
- **Outbox for settle-after-success:** if the settle write fails after the AI succeeded, the client gets 503 and the call is not billed. Retrying with the same key does **not** recover the answer: it gets 409 until the TTL, then the `ttl_expired` body. The client must send a new key (a new AI call). Production would write the AI result to a durable outbox and settle from a worker.
- **Real AI / circuit breaker / user auth / multi-replica:** out of assignment minimum; see README. Admin uses one shared token, not real accounts.

## 5. Assumptions

- One credit per AI request.
- `Idempotency-Key` scope is per `userId` for the lifetime of the DB (not per period).
- A duplicate request that arrives while the first is still running should be retried by the client, not held open by the server.
- Unknown users are allowed and metered immediately.
- `PERIOD` is a fixed UTC calendar window, not rolling.
- Docker runs a single replica sharing one volume.

## 6. Code walkthrough

- **Request id** (`RequestIdInterceptor`): always a server `randomUUID()`, returned in `x-request-id`; the client's header is only logged.
- **Reserve** (`LedgerRepository.reserve`): `BEGIN IMMEDIATE` → expire stale → idempotency check (hash mismatch → conflict; not terminal → in progress; terminal → replay) → if `used >= limit` append `REJECTED_QUOTA` else insert `RESERVED`, bump counter, write idempotency index. Synchronous only.
- **Settle** (`LedgerRepository.settle`): separate TX; if a terminal row exists, return `settled: false`; else append `COMMITTED` (counter unchanged) or `RELEASED` (counter −1), compute usage, and store `buildResponse(usage)` as the replay body in the same TX.
- **Idempotency:** `idempotency_index` stores hash + cached JSON; 409 on hash mismatch or in-flight duplicate; replays return the cache (429 again for a prior reject).
- **Expiry** (`expireStale` for one user before `/usage`, `expireAllStale` for the sweeper): inside `BEGIN IMMEDIATE`, select reservations past TTL with no terminal row, append `RELEASED` (`ttl_expired`), counter −1, store the replay body.
- **Reconcile** (`npm run reconcile` / `LedgerRepository.reconcile`): compares counter to `COMMITTED + all open RESERVED` per period; the CLI refuses a missing DB file.
- **Admin guard** (`UsersController.requireAdmin`): compares `x-admin-token` with `ADMIN_TOKEN` using `timingSafeEqual`.

## 7. Known weaknesses and next steps

- SQLite single-writer limits horizontal scale. Stress tests prove correctness under one-writer contention, not multi-replica throughput.
- Settle failure after AI success: the call is not billed and the answer is lost; the client needs a new key (add an outbox).
- Global idempotency keys may surprise callers who reuse keys across months (document or scope by period).
- SQLite connection is not closed on shutdown; WAL makes this safe, but a clean `close()` on module destroy would be tidier.
- Admin auth is one shared token; production needs real identities and an audit log of limit changes.
- Stress suite is opt-in (`npm run test:stress`); run it before claiming load safety.
- Next: Postgres CAS counters, partitioned ledger, real provider adapter, user auth.
