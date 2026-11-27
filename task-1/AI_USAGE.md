# AI usage — Task 1

## Tools used

I used Cursor (Composer) for the design draft, NestJS scaffolding, ledger and quota code, tests, Docker files, and the docs. While iterating I ran `npm test`, `npx tsc --noEmit`, and `npm start` locally.

## What was generated vs written or edited by hand

Most of the Nest layout (`src/main.ts`, `app.module.ts`, controllers, config) started as generated scaffolding that I then shaped.

I reworked these heavily after review:

- `ledger/schema.ts` and `ledger.repository.ts` (reserve/settle, idempotency, expiry, reconcile)
- `quota/quota.service.ts` and `reservation.sweeper.ts`
- e2e coverage under `test/`
- `DESIGN.md`, `DECISIONS.md`, and this note

Docs and Docker were drafted with the agent and trimmed by me.

## How the output was verified

- `npm test` (concurrency, multi-process SQLite, idempotency, timeout/late settle, TTL, period rollover, limit override, ledger immutability, reconcile, validation)
- `npm run test:stress` for the opt-in load cases
- `npx tsc --noEmit` and a clean `npm start`
- Line-by-line pass over reserve/settle against `DESIGN.md` and `DECISIONS.md`

Docker Compose lives in the repo. I used it while building the optional path. I am not claiming a fresh image rebuild as the last step before submission.

## What was corrected or rejected

- Throwing inside a `BEGIN IMMEDIATE` reserve TX rolled back the reject evidence. The AI call stays outside the transaction; quota rejects return from the TX and become HTTP 429 afterward.
- Double settle is blocked with a partial unique index on `reservation_id` where status is `COMMITTED` or `RELEASED` (`idx_ledger_terminal_settle`).
- Same key while the first call was still running used to return an empty "replay"; it is now 409 until settle, then the cached body.
- The idempotency response body is written in the same settle TX, not in a second write afterward.
- Pending usage counts only open `RESERVED` rows, not historical ones that already have a terminal sibling.
- Reconcile treats all open `RESERVED` (including expired-but-unswept) as held credit so it does not false-alarm after a crash.
- I kept Nest + SQLite only. No Redis, ORM, or Next.js UI for this task.

## Limits

I did not implement a durable outbox, hash-chain, real user auth, or multi-replica SQLite. Those are listed as skipped in `DECISIONS.md`. I also did not run a multi-hour soak beyond the opt-in stress suite.
