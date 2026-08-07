# A6 — Capability lookup: shared list/describe + tier filter

**Type:** `wayfinder:grilling` (HITL)
**Status:** **closed** (resolved 2026-08-07)
**Blocks:** A7, A8
**Blocked by:** A1 (closed)

`delivery: decision-only` — design locked; the build happens via A7/A8.

## Resolution

1. **Utility shape (Q1): lean — `list(token)` + `describe(name, token)`, no
   `listByTier`, no tier logic in core.** The kernel already does tier filtering
   (`capability.list` runs `checkAuthz(callerScope, full.permissions)` —
   `factory.ts:554-570`); a core-side `listByTier` would duplicate kernel logic and
   drift. The lookup's only job: build the canonical invocation, run it, map the
   error via the A5 envelope, return a neutral card list
   (`{name, description, inputSchema?, tier?}`). Scope fed to the kernel comes from
   `readClaims(token).scope` — core's own claim reader (A2 lock). Rules out a
   `tokenScopeDecoder` injection param (no pluggable decoder — `readClaims` exists)
   and MCP-shaped tool output from core (tool-card rendering stays in the MCP door —
   A1 edge ruling).
2. **Zero-delta (Q2): byte-identical by construction, unedited test suite as
   acceptance.** Ordering = kernel registry order (no sort today, none added);
   descriptions/schemas pass through verbatim; errors go through the A5 converter
   with MCP's table; tier filtering receives the identical scope bytes
   (`readClaims` == `decodeScopeFromToken` output); describe-denied → card kept
   with generic schema and describe-ok-but-no-record → card skipped stay MCP
   *rendering* decisions (door's bytes), now driven by neutral card flags. MCP's
   existing `scenarios.test.ts` + `translate.test.ts` run with ZERO edits — any
   byte diff = migration failure.
3. **Claim reader (Q3): `decodeScopeFromToken` moves to core as `readClaims(token)`
   — shared with A2.** `readClaims` returns the full claims object
   (`sub`/`scope`/`iat`/`exp`/`expectedOrigins`); `list()` uses `.scope`. MCP keeps
   working via a thin re-export alias or direct call-site swap — same base64url
   payload decode, same `[]` defensiveness (`translate.test.ts:132-143` stay
   green). Rules out a second claim reader (the only unsigned-JWT dup, A11) and
   moving it into gateway-core (kernel already verifies; the reader is a
   pre-verify convenience for adapters — its home is adapter-core).
4. **WS untouched (Q4): utility available, NO new behavior wired in v1.** No
   discovery frames, no new message types, no pre-fetch of catalogs. WS v1 surface
   stays exactly today's (`invoke` call/stream + `subscribe`/`unsubscribe` + auth);
   `capability.list` already works over a plain `invoke` frame (kernel capability,
   passthrough — `invoke.test.ts` exercises it). Any future WS discovery frame is
   its own ticket (see `future.md` §5). Rules out a WS `discover` frame in v1 and
   silently changing invoke behavior.

Future items surfaced during grilling are recorded in
`docs/wayfinder/adapter-core/future.md` (kernel streaming, channel `subscribe`
mode, backpressure/subscription graduation, WS discovery frame, error-catalog
setup validation, consumer-edge session policy).

## Question

Only MCP does capability discovery today (`listTools` → `capability.list` +
`capability.describe` + scope-based tier filtering). Should that move into adapter-core
as an optional shared utility — so the WS adapter and any future adapter can get the
same behavior without re-writing it?

## Context

- MCP: `adapter-mcp/src/translate.ts` — `listTools` calls `handleInvocation` with
  `capability.list` / `capability.describe`, filters tiers via `decodeScopeFromToken`.
- WS: no discovery today — registry.ts is per-connection bookkeeping only.
- Kernel: `capability.list` supports tier filtering (authz tier-aware, factory.ts
  `capability.list` filter); the `--tier` CLI flag exists.

## Sub-questions

1. Utility shape: `createCapabilityLookup(gateway, tokenScopeDecoder?)` returning
   `list()`, `describe(name)`, `listByTier()` — or leaner?
2. Zero-delta: MCP's tool list must come out byte-identical — does moving
   `listTools` under core preserve ordering, descriptions, error codes?
3. Does the scope-decoder (`decodeScopeFromToken`) move to core as the standard claim
   reader (shared with A2)?
4. WS adapter gains the utility but no new behavior in v1 — confirm the migration does
   not wire discovery into WS frames.
