# A2 — Auth pipeline: verify-early vs verify-late as a policy

**Type:** `wayfinder:grilling` (HITL)
**Status:** open
**Blocks:** A7, A8
**Blocked by:** A1

## Question

The two adapters authenticate at different times. WebSocket checks the token BEFORE the
first invoke (it needs the claims for origin binding + tenant state). MCP lets the kernel
check it as part of each invocation. How does adapter-core express both without a fork in
the code?

## Context

- WS: `adapter-websocket/src/auth.ts` — `authenticateToken` (verify → origin binding →
  tenant state), exported publicly; pre-auth timeout closes the socket (close 1008).
- MCP: `adapter-mcp/src/translate.ts` — `extractBearer` (header) + `decodeScopeFromToken`
  (only for capability-list tier filtering); no verify — the kernel verifies on
  `handleInvocation`.
- Kernel: `verifyToken` (`gateway-core/src/auth.ts:51`) — the shared verification
  primitive both paths can stand on.

## Sub-questions

1. Policy shape: an option like `verifyMode: "early" | "lazy"` (or a hook)?
2. What does "early" get you that "lazy" doesn't — pre-invoke tenant state, origin
   binding, connection-level identity? Is that list the contract?
3. Where does credential EXTRACTION live? (proposal: always in the adapter — reading
   the transport's own bytes; extraction is protocol-specific by definition)
4. Scope decode for capability filtering (MCP today): moves to core as part of the
   capability lookup (A6) or stays a MCP-local helper?
5. Zero-delta check: does moving WS's authenticateToken under adapter-core change the
   close codes / error text on any auth failure path?
