# A7 — WebSocket server migration plan

**Type:** `wayfinder:grilling` (HITL)
**Status:** **closed** (resolved 2026-08-07)
**Blocks:** — (delivery after A2–A6 resolve)
**Blocked by:** A1, A2, A3, A4, A5, A6

`delivery: shipped` — WS server pipeline migrated onto `@spanexx/adapter-core` v0.1.0
with zero observable delta. See `docs/features/adapter-core/{PRD-TRD,IMPL}-adapter-core.md`
for the locked plan and `docs/features/adapter-core/simulate.sh` for the post-impl sim
(24/24 PASS, all PRD scenarios S1–S8 satisfied). Gates held: core 50/50, WS 54/54
unedited, sim 37/37, full repo 1039/1039, build clean.

## Question

How does `adapter-websocket`'s server-side pipeline move onto adapter-core while the
wire client + W1–W6 envelope stay in the package — with every existing test and the
`simulate-websocket-adapter.mjs` sim green?

## Context

- Package surface today (`index.ts`): server = `createWebSocketAdapter`,
  `authenticateToken`, `ConnectionRegistry`, `WS_ERROR_CODES`; client = `createWsClient`,
  `WsInvokeError`, `WsDoorMismatchError` (imported by `agentide/src/consumer.ts` — must
  not move).
- Server files: `auth.ts` (→ A2), `invoke.ts` (→ A4/A5), `errors.ts` (→ A5),
  `queue.ts`/`fanout.ts` (→ A4), `registry.ts` (bookkeeping — shared or stays?),
  `protocol.ts` (envelope — stays), `server.ts` (wiring — mostly stays).
- Tests: auth, invoke, fanout, client, client-timeout, + protocol/server/registry
  suites; sim `simulate-websocket-adapter.mjs` (31 assertions).

## Sub-questions

1. File-by-file move map: which files shrink, which move, which stay — with the public
   exports that must remain for the client half?
2. Do `ConnectionRegistry` + queueing become adapter-core primitives (shared with
   future adapters) or stay adapter-local?
3. Test strategy: move tests with the code, or keep adapter tests as black-box contract
   tests over the new imports?
4. Migration order within the package (e.g. errors → auth → invoke) that keeps every
   intermediate commit green?
