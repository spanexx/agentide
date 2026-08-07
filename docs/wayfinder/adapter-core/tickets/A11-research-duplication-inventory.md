# A11 — Research: formal duplication inventory

**Type:** `wayfinder:research` (AFK)
**Status:** **closed** (resolved 2026-08-07)
**Blocks:** — (informs A1–A8; does not gate)
**Blocked by:** —

## Resolution

Inventory complete — `docs/wayfinder/adapter-core/research/A11-duplication-inventory.md` (branch `research/adapter-core-a11`, commit `345535f`). Headline: 16 duplicated pipeline files (11 WS + 5 MCP, 2,222 lines), 14 test files (1,830 lines), 2 sims. Corrections to charting context: `decodeScopeFromToken` (`translate.ts:54-73`) is the only unsigned-JWT duplication; Bearer extraction lives in `server.ts:44` (not translate.ts); `backend-runtime/src/verify.ts` (81 lines) is the only file-level copy. Kernel contracts NOT duplicated: 5.

## Question

A durable, file-by-file inventory of the duplicated adapter pipeline — the facts every
boundary (A1) and migration ticket (A7/A8) reasons over. Charting already found the
headlines; this formalizes them with exact references so later sessions don't re-dig.

## Context

- Known duplication: WS `auth.ts`/`invoke.ts`/`errors.ts`/`queue.ts`/`fanout.ts` vs MCP
  `translate.ts`/`error-map.ts`; `backend-runtime/src/verify.ts` is a local copy of
  gateway-core `verifyToken` (deliberate, out of scope — document it anyway).
- Kernel contracts: `CanonicalInvocation` (`types.ts:56`), `verifyToken`
  (`gateway-core/src/auth.ts:51`), `originMatches` (`@spanexx/origin`).
- Import surfaces: `agentide/src/consumer.ts` imports `createWsClient, WsInvokeError,
  WsDoorMismatchError` from adapter-websocket.

## Output

`docs/wayfinder/adapter-core/research/A11-duplication-inventory.md` — per file: path,
role, what it duplicates (with the shared twin's path:line), test/sim coverage counts,
public exports. Also list what is NOT duplicated (kernel-owned). Branch:
`research/adapter-core-a11`.
