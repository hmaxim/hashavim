# AI usage — Task 2

## Tools used

I used Cursor (Composer) for the Next.js 15 scaffold, reducer/SSE/server store, UI panels, Vitest/RTL tests, and the README/DECISIONS/Docker docs. Local checks were `npm test`, `npx tsc --noEmit`, `npm run build`, and `npm start`.

## What was generated vs written or edited by hand

Scaffold, route handlers, panel markup/CSS, and Docker files came from the agent and I edited them in place.

I rewrote these after review:

- `src/state/reducer.ts` and `actions.ts` (optimistic path, ack by `seq`, rollback)
- `src/state/selectors.ts` (ref-keyed memoization)
- `src/hooks/useEventStream.ts` (StrictMode, reconnect)
- `src/server/store.ts` and `eventStream.ts`
- Board integration tests with a fake EventSource

## How the output was verified

- `npm test` (reducer, actions failure paths, server store/mock, SSE stream, activity labels, Board integration, selector invariants)
- `npx tsc --noEmit`, `npm run build`, and `npm start` (including after a prior `npm run dev`, which used to leave a non-production `.next`)
- Curl checks against a running server for the mutation response `seq` shape
- Line-by-line read of the reducer, actions, SSE hook, and server store against `DECISIONS.md`

I exercised two-browser-tab sync while developing the cases listed in `DECISIONS.md`. I did not treat a polished interviewer demo as a separate gate.

## What was corrected or rejected

- `app/page.tsx` (and the API routes) set `export const dynamic = 'force-dynamic'` so `next build` does not statically cache the initial board snapshot.
- Task route handlers take `params` as a `Promise` and `await` it, matching Next.js 15.
- All board mutations go through one pure `applyEvent` reducer behind a per-request `createBoardStore` factory (no module singleton).
- Selectors that returned a new array every call caused a Zustand update loop; they are memoized on store object refs.
- SSE subscribes before sending the snapshot so a write during connect is not lost.
- Pending edits settle on the HTTP `seq` ack when there is no echo (server no-op, or echo folded into a reconnect snapshot).
- I rejected inventing a client `seq` on 404; the client uses `ensureDeleted` instead.
- No Zod/Yup; small shared validators in `src/lib/validation.ts`.

## Limits

The board is in-memory and single-process. I did not run multi-node deployment or a long soak. Playwright two-tab E2E is listed as a next step, not done here. Docker is an optional path in the repo; I am not claiming a final image rebuild for this write-up.
