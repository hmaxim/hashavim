# Hashavim take-home

Two independent tasks. Each folder has its own app, dependencies, tests, and docs. Nothing at the repo root runs either service.

**Runtime:** Node.js 20+ for both tasks (or Docker).

Both default to `PORT=3000`. If you run them at the same time, set a different `PORT` for one of them.

## Layout

```text
hashavim/
├── README.md          ← this file
├── task-1/            ← NestJS + SQLite usage metering
└── task-2/            ← Next.js shared task board
```

## Task 1 — AI Usage Metering & Quota System

NestJS + SQLite metering service with an append-only ledger and reserve → execute → settle quota enforcement.

```bash
cd task-1
docker compose up --build   # serve on PORT (default 3000); single replica only
# or
npm start                   # install if needed, build, serve on PORT (default 3000)

npm test                    # default suite
npm run test:stress
npm run reconcile           # counter vs ledger drift check
```

| Doc | What it covers |
| --- | --- |
| [task-1/README.md](task-1/README.md) | Runbook, config, API curls, scope |
| [task-1/DESIGN.md](task-1/DESIGN.md) | Architecture and invariants |
| [task-1/DECISIONS.md](task-1/DECISIONS.md) | Trade-offs and edge cases |
| [task-1/AI_USAGE.md](task-1/AI_USAGE.md) | How AI tools were used |

## Task 2 — Shared-State Team Task Board

Next.js 15 board with Zustand + a pure reducer and SSE mock updates. Five panels stay in sync.

```bash
cd task-2
docker compose up --build   # serve on PORT (default 3000)
# or
npm start                   # install if needed, build if needed, serve on PORT (default 3000)

npm test                    # Vitest
npm run dev                 # hot reload
```

Open two browser tabs on `http://localhost:3000` to see live sync and mock updates.

| Doc | What it covers |
| --- | --- |
| [task-2/README.md](task-2/README.md) | Runbook, state model, scope |
| [task-2/DECISIONS.md](task-2/DECISIONS.md) | Trade-offs and edge cases |
| [task-2/AI_USAGE.md](task-2/AI_USAGE.md) | How AI tools were used |
