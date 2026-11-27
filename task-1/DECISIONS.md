# Decisions — Task 1 Usage Metering

> **AI tools are allowed and encouraged. You must be able to explain every line you submit.**
> **Clear decisions and edge-case handling matter more than completeness. If you skip something, say so and explain why.**

## 1. AI usage

Cursor Agent implemented this task from the Task 1 skill: design doc, NestJS/SQLite service, tests, Docker, and docs. Generated scaffolding was reviewed and corrected (e.g. not throwing inside reserve TX, pending counts excluding settled reservations). See [AI_USAGE.md](AI_USAGE.md).

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
| Fail-closed on storage errors | Fail-open (serve AI anyway) | Never unmetered usage | Availability dips when DB locked |
| No AI retries | Automatic retry with backoff | Avoid double-charge / ambiguous settle | Transient AI blips surface as released |
| Auto-create unknown users | Reject unknown | Fewer moving parts for demo | No explicit user registry |
| Limit changes apply immediately | Next-period only | Matches “X is configurable” intent | Lowering can block mid-period |
| TTL + sweeper for stuck RESERVED | Manual admin only | Crash between reserve and settle recovers | Brief over-hold of credit until TTL |
| Docker as optional extra | Docker-only | `npm start` remains primary | Two run paths to maintain |

## 3. Edge cases

| Edge case | Handled? | How / why skipped | Test |
| --- | --- | --- | --- |
| Concurrent at limit boundary | Yes | `BEGIN IMMEDIATE` serialize | concurrency + multi-process |
| Client retries / Idempotency-Key | Yes | Index + cached response | idempotency replay |
| Same key different payload | Yes | Hash compare → 409 | idempotency 409 |
| AI failure | Yes | `RELEASED`, counter −1 | AI failure test |
| AI timeout + late settle | Yes | Terminal unique + settle no-op | timeout + late settle |
| Crash reserve→settle | Yes | TTL lazy + sweeper | stale RESERVED test |
| Period boundaries | Yes | Fixed UTC; bill reserve period | period rollover |
| Limit change mid-period | Yes | Override table; snapshot on row | raise/lower + override |
| Per-user override | Yes | `PUT .../limit` | limit override test |
| Unknown user | Yes | Auto-create on first reserve | implicit in all tests |
| Invalid user/payload | Yes | class-validator → 400 | invalid payloads |
| Clock skew / multi-instance | Partially | Server Clock only; multi-process same DB tested; no multi-region | multi-process |
| Limit 0 / bad config | Yes | Validation at startup + runtime | limit=0 + config.spec |
| Idempotency across periods | Yes | Unique per user globally; replay | replay test |
| Usage while in flight | Yes | Pending = open RESERVED | in-flight pending |
| Ledger tampering | Partially | Triggers block UPDATE/DELETE; no hash-chain | immutability test |
| Refund semantics | Yes | Failure → RELEASED evidence | AI failure test |
| Rate-limit vs quota | No | Mentioned only; out of scope | — |

## 4. Skipped or simplified, and why

- **Hash-chain:** not needed to prove append-only with triggers; add later for stronger dispute evidence.
- **Outbox for settle-after-success:** TTL + idempotent retry enough for demo; production needs durable settle.
- **Real AI / circuit breaker / auth / multi-replica:** out of assignment minimum; see README.

## 5. Assumptions

- One credit per AI request.
- `Idempotency-Key` scope is per `userId` for the lifetime of the DB (not per period).
- Unknown users are allowed and metered immediately.
- `PERIOD` is a fixed UTC calendar window, not rolling.
- Docker runs a single replica sharing one volume.

## 6. Code walkthrough

- **Reserve** (`LedgerRepository.reserve`): `BEGIN IMMEDIATE` → expire stale → idempotency check → if `used >= limit` append `REJECTED_QUOTA` else insert `RESERVED`, bump counter, write idempotency index. Synchronous only.
- **Settle** (`LedgerRepository.settle`): separate TX; if terminal exists, no-op; else append `COMMITTED` (counter unchanged) or `RELEASED` (counter −1). Partial unique index blocks double terminal rows.
- **Idempotency:** `idempotency_index` stores hash + cached JSON; conflict on hash mismatch; replays return cache (429 again for prior reject).
- **Sweeper** (`ReservationSweeper`): interval calls `expireAllStale` which appends `RELEASED` with `ttl_expired`.
- **Reconcile** (`npm run reconcile` / `LedgerRepository.reconcile`): compares counter to `COMMITTED + open RESERVED` per period.

## 7. Known weaknesses and next steps

- SQLite single-writer limits horizontal scale.
- Settle failure after AI success is only healed by TTL/retry (add outbox).
- Global idempotency keys may surprise callers who reuse keys across months (document or scope by period).
- Next: Postgres CAS counters, partitioned ledger, real provider adapter, auth.
