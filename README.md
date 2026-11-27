# Hashavim take-home

Two independent tasks. Each lives in its own folder and runs on its own.

## Task 1 — AI Usage Metering & Quota System

NestJS + SQLite metering service with an append-only ledger and reserve → execute → settle quota enforcement.

```bash
cd task-1
npm start
```

Tests: `cd task-1 && npm test`

Details: [task-1/README.md](task-1/README.md)

## Task 2 — Shared-State Team Task Board

Next.js 15 board with Zustand + pure reducer and SSE mock updates. Five panels stay in sync.

```bash
cd task-2
npm start
```

Tests: `cd task-2 && npm test`

Details: [task-2/README.md](task-2/README.md)
