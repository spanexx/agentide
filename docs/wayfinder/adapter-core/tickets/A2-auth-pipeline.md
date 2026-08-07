# A2 — Auth pipeline: verify-early vs verify-late as a policy

**Type:** `wayfinder:grilling` (HITL)
**Status:** **closed** (resolved 2026-08-07)
**Blocks:** A7, A8
**Blocked by:** A1 (closed)

`delivery: decision-only` — design locked; the build happens via A7/A8.

## Resolution

1. **Policy shape (Q1):** one knob — `auth: { mode: "early" | "lazy" }` — one verify
   function underneath, two call sites. `early` = verify at connection/request start
   (WebSocket); `lazy` = token rides through, kernel verifies per call (MCP; future
   REST). Rules out per-protocol auth code in doors and any auth plugin system.
2. **Early-mode contract (Q2):** verify once at open → verified identity (caller,
   tenant, scope) **cached for the connection's lifetime**; optional pre-verify hook
   (WS origin binding — `expectedOrigins`, `ORIGIN_MISMATCH`); a pipeline
   **re-verify(token)** call for mid-connection refresh (WS re-auth) — door decides
   when, pipeline swaps the cached identity safely. Caching preserves today's
   connection behavior exactly (revoked token does not kill a live connection).
3. **Claim reader (Q3):** `decodeScopeFromToken` moves to adapter-core as a standalone
   pure `readClaims(token)` — shared with the capability lookup (A6). It reads a
   token, not a transport — crosses the A1 boundary line. MCP's tool list stays
   byte-identical.
4. **Zero-delta freeze (Q4):** auth failure behavior is FROZEN — WS close codes
   (1008 auth fail, 1008 pre-auth timeout), `auth.error` text, `WS_ERROR_CODES`,
   `ORIGIN_MISMATCH` + Node bypass, MCP JSON-RPC error responses, audit `denied`
   records: all unchanged. Acceptance rule: **asserted today = frozen forever**;
   anything not asserted may change. A7/A8 inherit this rule.

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
