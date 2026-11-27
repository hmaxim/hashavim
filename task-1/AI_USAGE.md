# AI usage — Task 1

## Tools used

- **Cursor Agent (Composer):** read `AGENTS.md` / Task 1 skill, drafted `DESIGN.md`, scaffolded NestJS modules, ledger/quota logic, tests, Docker, and docs.
- **Local tooling:** `npm test`, `tsc`, and Docker Compose were run in the agent session to verify behaviour.

## What was generated vs written by hand

- **Mostly agent-generated then edited:** Nest app layout, ledger schema/triggers, reserve/settle, sweeper, e2e tests, Dockerfiles, README/DECISIONS/DESIGN.
- **Corrected after review (agent):** throwing `QuotaExceeded` inside the reserve transaction (would roll back evidence) → return `rejected` then HTTP 429 outside the TX; pending count including settled `RESERVED` rows → exclude terminal siblings; in-flight pending test timing → gated AI provider.
- **[AUTHOR TO CONFIRM]** Any edits made outside this agent session before submission.

## How the output was verified

- `npm test` (concurrency, multi-process, idempotency, timeout/late settle, TTL, period rollover, limit override, immutability, reconcile, validation).
- `npx tsc --noEmit` / build via `npm start` path.
- Docker compose build/run and sample curls against the container. **[AUTHOR TO CONFIRM]** if re-run manually before submit.
- Line-by-line review of reserve/settle/idempotency paths against the skill invariants.

## What was corrected or rejected

- Rejected rolling back quota-reject ledger rows via thrown errors inside TX.
- Rejected counting historical `RESERVED` rows as pending after commit/release.
- Rejected flaky sleep-based in-flight test; replaced with block/release AI gate.
- Avoided Next.js / UI and extra deps (Redis, ORMs) per skill.

## Limits

- Production hardening (auth, outbox, hash-chain) was not implemented; documented as skipped.
- **[AUTHOR TO CONFIRM]** Human explanation rehearsal of every line before interview.
