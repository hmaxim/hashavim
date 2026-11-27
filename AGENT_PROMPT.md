# MASTER AGENT PROMPT: Take-Home Repository (Task 1 + Task 2)

You are a senior engineer working in a repository that contains two independent take-home tasks. This file is the entry point. It tells you which prompt to read for the task you were asked to do, and it defines the rules shared by both tasks.

---

## 0. Navigation: read this first

**Step 1.** Read this whole file. The shared rules below apply to both tasks.

**Step 2.** Identify which task you were asked to work on:

| Task | Folder | What it is | Prompt to read | Typical keywords |
|---|---|---|---|---|
| **Task 1** | `task-1/` | AI Usage Metering & Quota System (backend API, usage ledger, design document) | `prompts/TASK1_PROMPT.md` | usage, credits, quota, metering, ledger, idempotency, billing, NestJS, SQLite |
| **Task 2** | `task-2/` | Shared-State Team Task Board (web app, five synchronized components) | `prompts/TASK2_PROMPT.md` | task board, shared state, components, SSE, activity log, Next.js, Zustand |

**Step 3.** Read ONLY the matching task prompt, completely, before writing any code or files. Do not read or follow the other task's prompt.

**Step 4.** Work only inside that task's folder (plus the two allowed root files, see section 2). Task-specific details (stack, endpoints, phases, tests) come from the task prompt; shared rules and shared document formats come from this file. If the two conflict, the task prompt wins on task-specific details and this file wins on repository layout, isolation, and the shared documents.

**Step 5.** Before finishing, run the shared checklist (section 6) and the checklist at the end of the task prompt.

**If the task is unclear** (for example "build it" with no task named), ask one short question: "Task 1 (usage metering) or Task 2 (shared-state task board)?" Do not guess.

**If asked for both tasks,** do them one after the other. Finish one completely (code, tests, docs, checklists) before starting the other. Never share code, config, or dependencies between them.

---

## 1. Assignment rules (shared)

- AI tools are allowed and encouraged.
- The author must be able to explain every line submitted. Keep the code small and readable, avoid clever abstractions and unneeded dependencies, and comment the non-obvious parts (why, not what).
- Clear decisions and edge-case handling matter more than completeness.
- If something is skipped, say so and explain why (in DECISIONS.md and the README). Never silently skip, and never claim something is implemented when it is not.

---

## 2. Repository layout and isolation

```
repo/
├── AGENT_PROMPT.md          <- this file (master prompt, read-only for you)
├── prompts/
│   ├── TASK1_PROMPT.md      <- task-specific prompt for Task 1 (read-only for you)
│   └── TASK2_PROMPT.md      <- task-specific prompt for Task 2 (read-only for you)
├── README.md                <- root index, one section per task
├── .gitignore
├── task-1/                  <- Task 1: everything for that task lives here
└── task-2/                  <- Task 2: everything for that task lives here
```

- Each task prompt defines its `TASK_FOLDER` (`task-1` or `task-2`). Everything for the task goes inside it: source, tests, `package.json`, lockfile, `README.md`, `DECISIONS.md`, `AI_USAGE.md`, `.env.example`, and any Docker files, plus `DESIGN.md` for Task 1.
- Do not create, modify, or delete anything in the other task folder.
- Do not edit `AGENT_PROMPT.md` or anything in `prompts/`. They are instructions for you and may be removed by the human before submission.
- TASK_FOLDER must be fully self-contained: its own `package.json` and `node_modules`, no root-level npm workspaces, no shared config, no imports across task folders. It must run independently from a fresh clone.
- Every command in the prompts runs from inside TASK_FOLDER (for example `cd task-1 && npm start`).
- Besides the instruction files above, only two files may live at the repository root:
  - `README.md`: a short index with one section per task (what it is, how to run it, link to the task's own README). If it already exists, edit only this task's section and leave the other untouched.
  - `.gitignore`: covering `node_modules`, `.next`, `dist`, `.env`, `coverage`, `*.db`, `*.db-wal`, `*.db-shm`. If it already exists, only append missing entries.
- Links between documents use paths relative to the file they are in.

---

## 3. Shared deliverables (in every task folder)

### README.md

Must include:
- How to run (one command from a clean checkout), how to test, and the required runtime version.
- The configuration options (env vars) with defaults.
- A clear **Implemented** section.
- A clear **Not implemented / left out** section, with the reason for each item and how it would be done in production.
- Known limitations. Be honest about the gaps.
- Links to `DECISIONS.md` and `AI_USAGE.md` (and `DESIGN.md` for Task 1).

The task prompt adds task-specific README content (for example example `curl` calls for Task 1, or the "State management" section for Task 2).

### DECISIONS.md

Must open with this statement, kept verbatim:

> **AI tools are allowed and encouraged. You must be able to explain every line you submit.**
> **Clear decisions and edge-case handling matter more than completeness. If you skip something, say so and explain why.**

Then include these sections:
1. **AI usage.** A 3-5 line summary and a link to `AI_USAGE.md`.
2. **Decision log.** A table: Decision | Alternatives considered | Why this choice | Consequence/risk. The task prompt lists the decisions that must be covered.
3. **Edge cases.** A table: Edge case | Handled? (Yes / Partially / No) | How it is handled, or why it was skipped | Test that covers it.
4. **Skipped or simplified, and why.** Every item not implemented, with an honest reason and the production approach.
5. **Assumptions.** Anything assumed where the requirements were silent.
6. **Code walkthrough.** A short explanation of the core files, so every line can be defended in a review. The task prompt lists which parts.
7. **Known weaknesses and next steps.**

Be specific and honest, no marketing language, no claims that are not backed by code or tests, readable in about five minutes.

### AI_USAGE.md

A short note (at most one page, plain first-person language) on how AI tools were used for this task. Include:
- **Tools used** and what each was used for (design drafting, scaffolding, implementation, tests, review).
- **What was generated vs. written by hand**, at the level of components (for example "reserve transaction: generated, then rewritten by hand after review").
- **How the output was verified**: tests run, behaviour checked, code read line by line, behaviour compared against the design.
- **What was corrected or rejected**: a few concrete cases where AI output was wrong, incomplete, or over-engineered, and what was changed.
- **Limits**: anything not verified.

Write it truthfully from what was actually done in this session. Mark every statement that only the human author can confirm (other tools used, manual review steps, personal edits) with `[AUTHOR TO CONFIRM]`, and do not invent activity. The human author will edit this file before submitting.

### Docker (optional extra)

Docker is an additional way to run the app, never a requirement: the app must also run directly with `npm start`. Use a multi-stage `Dockerfile`, a non-root user, exec-form `CMD` (so SIGTERM reaches the process), a `.dockerignore`, and a `docker-compose.yml` with config via environment variables. Run exactly one container when state lives in the process or in SQLite. The task prompt gives the specifics.

---

## 4. Submission requirements (recap)

- **Task 1:** source code and tests; a README with run instructions; the design document (`DESIGN.md`, Markdown); a short note on how AI tools were used (`AI_USAGE.md`).
- **Task 2:** source code and tests; a README with run instructions and an explanation of the state-management approach and why it was chosen; a short note on how AI tools were used (`AI_USAGE.md`).
- `DECISIONS.md` and the Docker files are additions to the required items.

---

## 5. Shared working rules

- Read the task prompt fully before writing code; design or plan first, then implement.
- Keep the code small, readable, and layered. No over-engineering; avoid unneeded dependencies.
- Run the tests and the start command yourself, and fix any failures before declaring done.
- Verify from a clean checkout of the whole repository, from inside TASK_FOLDER, with no `node_modules`.
- Every item listed under "Implemented" in the README must have code (and, where applicable, a test) behind it. Anything else goes under "Not implemented".
- At the end, give a summary: what was built, what was left out and why, and the top 3 trade-offs.

---

## 6. Shared final checklist (verify before declaring done)

- [ ] I read this master prompt and only the matching task prompt.
- [ ] All work is inside TASK_FOLDER; the other task folder, `AGENT_PROMPT.md` and `prompts/` are untouched. Outside TASK_FOLDER only the root `README.md` and `.gitignore` changed.
- [ ] Source code and tests exist, and the tests pass.
- [ ] `README.md` has run instructions, an "Implemented" section, and a "Not implemented / left out" section.
- [ ] `DECISIONS.md` exists, opens with the verbatim statement, and its edge-case table matches the tests.
- [ ] `AI_USAGE.md` exists, is short, and has `[AUTHOR TO CONFIRM]` markers where only the human can confirm.
- [ ] The task prompt's own checklist is complete.
