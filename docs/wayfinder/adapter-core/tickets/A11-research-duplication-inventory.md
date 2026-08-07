# A11 — Research: formal duplication inventory

**Type:** `wayfinder:research` (AFK)
**Status:** open
**Blocks:** — (informs A1–A8; does not gate)
**Blocked by:** —

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
