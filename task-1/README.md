# Task 1: AI Usage Metering & Quota System

NestJS + SQLite service that meters AI requests with an append-only usage ledger and atomic reserve → execute → settle quota enforcement.

**Runtime:** Node.js 20+ (or Docker)

## How to run

```bash
cd task-1
docker compose up --build
# or
npm start
```

`docker compose up --build` builds the image and serves on `PORT` (default `3000`). Data lives in the named volume `usage_data` mounted at `/data` (`DB_PATH=/data/usage.db`). Reset with `docker compose down -v`.

`npm start` installs dependencies if `node_modules` is missing, builds TypeScript, and serves on `PORT` (default `3000`).

**Limitation:** run exactly **one** replica. SQLite is not safe for multi-writer scale-out (see [DESIGN.md](DESIGN.md)).

### Tests

```bash
npm test            # default suite (excludes stress)
npm run test:stress # burst / sustained / idempotent / multi-user races
npm run test:all    # everything
```

### Reconcile counters vs ledger

```bash
npm run reconcile
```

## Configuration

| Env var | Default | Meaning |
| --- | --- | --- |
| `PORT` | `3000` | HTTP port |
| `DB_PATH` | `./data/usage.db` | SQLite file path |
| `DEFAULT_LIMIT` | `100` | Global per-user credit limit per period |
| `PERIOD` | `daily` | `daily` or `monthly` (fixed UTC calendar window) |
| `AI_FAILURE_RATE` | `0.15` | Simulated AI failure probability `[0,1]` |
| `AI_MIN_DELAY_MS` | `50` | Min simulated AI latency |
| `AI_MAX_DELAY_MS` | `500` | Max simulated AI latency |
| `AI_TIMEOUT_MS` | `2000` | Hard AI timeout |
| `RESERVATION_TTL_SECONDS` | `30` | Stuck `RESERVED` expiry; must be longer than `AI_TIMEOUT_MS` |
| `SWEEPER_INTERVAL_MS` | `5000` | Background expiry interval |
| `ADMIN_TOKEN` | unset | Secret for `PUT /v1/users/:userId/limit` (header `x-admin-token`); admin route returns 403 when unset |

See [`.env.example`](.env.example). Bad config fails fast at startup.

## Example curls

```bash
# AI request (optional Idempotency-Key)
curl -sS -X POST http://localhost:3000/v1/ai/requests \
  -H 'content-type: application/json' \
  -H 'Idempotency-Key: demo-1' \
  -d '{"userId":"alice","prompt":"hello"}'

# Usage
curl -sS 'http://localhost:3000/v1/users/alice/usage?includeRecent=true'

# Per-user limit override
# (start the server with ADMIN_TOKEN=change-me)
curl -sS -X PUT http://localhost:3000/v1/users/alice/limit \
  -H 'content-type: application/json' \
  -H 'x-admin-token: change-me' \
  -d '{"limit":10}'

# Health
curl -sS http://localhost:3000/health
```

## Implemented

- `POST /v1/ai/requests` with reserve → simulated AI → settle
- `GET /v1/users/:userId/usage` (limit, used, pending, remaining, period, optional recent ledger)
- `PUT /v1/users/:userId/limit` per-user override, protected by `ADMIN_TOKEN`
- Append-only ledger with SQLite triggers blocking `UPDATE`/`DELETE`
- Atomic `BEGIN IMMEDIATE` quota transactions (never spanning AI `await`)
- Idempotency-Key (auto UUID if omitted); payload mismatch → 409; duplicate while the first call is in flight → 409
- 429 on quota exceeded; 503 if storage unavailable (fail-closed)
- TTL expiry (lazy + sweeper) for stuck reservations
- Fixed UTC daily/monthly periods; mid-period limit changes; auto-create users
- Injectable `Clock` and `AiProvider` for tests
- `npm run reconcile` drift check (exits 1 on drift, 2 if `DB_PATH` does not exist)
- Structured JSON logs with a server-generated `request_id` (client `x-request-id` is logged as `client_request_id`, never stored as evidence)
- Jest + supertest suite (concurrency, multi-process SQLite, idempotency, timeout, TTL, period rollover, immutability, reconcile)
- Optional stress suite (`npm run test:stress`): 500-way burst, sustained mixed traffic, parallel idempotent retries, 100 users racing last credit
- Docker multi-stage image + compose volume

## Not implemented / left out

| Item | Why | Production approach |
| --- | --- | --- |
| Hash-chain tamper evidence | Extra complexity for take-home | Append hash of previous row per user |
| Real AI provider | Assignment asks for simulation | Swap `AiProvider` implementation |
| Circuit breaker / AI retries | Retries risk double-charge | Idempotent provider calls + breaker |
| Postgres / Redis scale-out | Local SQLite only | Counter CAS + partitioned ledger |
| Outbox for settle-after-AI-success | Rare path; the call is released unbilled by TTL, but the answer is lost and the client must retry with a new key | Durable outbox + worker |
| User auth / abuse rate limits | Out of scope vs quota (admin route has a shared token only) | API keys + edge rate limits |
| Multi-replica Docker | SQLite single-writer | One replica or move to Postgres |

## Known limitations

- Single process / single Docker replica for the SQLite file.
- Settle failure after a successful AI call returns 503 and leaves `RESERVED` (shown as pending) until TTL/sweeper releases it unbilled. Retrying with the same `Idempotency-Key` gets 409 until then and afterwards the `ttl_expired` body (`ai: null`); use a new key to get an answer.
- Simulated AI only.

## Docs

- [DESIGN.md](DESIGN.md) — architecture and trade-offs
- [DECISIONS.md](DECISIONS.md) — decision log and edge cases
- [AI_USAGE.md](AI_USAGE.md) — how AI tools were used
