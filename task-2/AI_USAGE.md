# AI usage — Task 2

I used **Cursor (Composer)** in this session for design drafting from the Task 2 skill, scaffolding the Next.js 15 app, implementing the reducer/store/SSE/server mock, building the five panels, writing Vitest/RTL tests, and drafting README/DECISIONS/Docker.

## Generated vs hand-tuned

- **Mostly generated, then edited:** project scaffold, API route handlers, UI panels, CSS layout, Docker files, docs.
- **Heavily rewritten after review:** `applyEvent` echo/rollback/snapshot re-apply; selector memoization (Zustand infinite-loop fix); `useEventStream` StrictMode generation handling; Board integration tests (FakeEventSource + cleanup).
- **[AUTHOR TO CONFIRM]** any edits made outside this agent session before submission.

## How it was verified

- `npm test` — 20 tests passing (reducer, server store, Board integration, randomized selector invariants).
- `npx tsc --noEmit`
- `npm run build` / `npm start` after docs
- Line-by-line read of reducer, actions, SSE hook, and server store against the skill’s invariants
- **[AUTHOR TO CONFIRM]** manual two-tab browser check of edits + mock updates

## Corrected or rejected AI output

- Early selectors returned new arrays every call → Zustand “getSnapshot should be cached” / max update depth; fixed with ref-keyed memoization.
- Default `EventSource` factory in `useEventStream` was recreated each render; stabilized with a module-level factory + ref.
- 404 handling that invented a client `seq` was rejected; replaced with `ensureDeleted`.
- Integration tests that clicked away from the title input blurred before injecting a remote title; inject via `act` while focused instead.
- Over-engineered validation libraries were not added; small hand-written validators match the skill.

## Limits

- Two-tab live demo and Docker image build may need a final human pass. **[AUTHOR TO CONFIRM]**
- AI_USAGE statements about other tools or offline edits are marked for author confirmation only.
