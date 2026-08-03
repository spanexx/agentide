# D4 — Token handling: mint, store, origin-bind, refresh

**Type:** `wayfinder:grilling` (HITL — delegated 2026-08-03: user granted full
decision authority for the remaining tickets, alignment mandate: PHILOSOPHY.md +
existing locks + code reality)
**Status:** closed 2026-08-03 (autonomous resolution under delegation)
**Blocks:** D3 (UI shape) — resolved

## Question

How does the web dashboard UI obtain and hold its gateway token, and how is the
token kept safe given it lives in the browser?

## Context (from the map + GRILL)

- Q4 lock: browser-held token in v1. Read-only `dashboard-bot`, scope
  `platform.*.read`, origin-bound, localhost binding.
- sdk-browser T5 Q2 shipped the `expectedOrigins` claim pattern (JWT claim,
  backend-runtime enforces post-auth Origin check; `auth.token.issue --kind
  browser --origin <origin>` CLI flags exist).
- Gateway tokens: HS256, default 1h lifetime, refresh via re-issue
  (gateway-core Q2 lock). No refresh endpoint — operator re-mints.
- The dashboard package serves the static UI page; the UI connects to the
  adapter-websocket port with the token.

## Sub-questions

1. **Where does the UI get the token?** Options: (a) operator mints
   `agentide token issue --tenant <t> --caller dashboard-bot --scope
   platform.*.read --kind browser --origin http://localhost:<port>` and puts it
   in dashboard package config / env; package injects it into the served page
   (config-driven, no hardcode). (b) UI asks the operator to paste it once,
   stored in localStorage. Recommend (a) — recommend up front, grill.
2. **Origin binding:** `expectedOrigins` = the dashboard's origin
   (`http://localhost:<port>`), enforced by backend-runtime — confirm reuse,
   no new server work.
3. **Scope:** `platform.*.read` covers `dashboard.view.*` (tier read) — confirm
   the token needs nothing more (no `dashboard.*`-specific scope string).
4. **Lifetime/refresh:** 1h default token in a browser tab — acceptable, or
   longer dashboard-specific lifetime at issuance? Refresh = operator re-mints
   + reloads page, or dashboard package re-mints a token automatically (it
   holds no gateway secret — can it? It is in-process with the gateway... can
   it call `auth.token.issue` internally?) — grill.
5. **Localhost binding:** the served page is on localhost — does the token
   need origin `http://localhost:<port>` exactly; what about 127.0.0.1 vs
   localhost divergence?
6. **Leak surface:** what happens if the token leaks — read-only worst case;
   confirm that is the accepted residual risk + document.

## Resolution must record

The locked token lifecycle (mint command shape, storage, injection point,
origin claim, lifetime, refresh path, leak posture). Update CONTEXT.md + this
ticket on every lock.

## Resolution (locked 2026-08-03, autonomous under user delegation)

### Corrected facts first (ticket Context claims vs code reality)

- Ticket claimed "`auth.token.issue --kind browser --origin <origin>` CLI flags
  exist" — **FALSE.** `agentide token issue` supports only `--tenant`,
  `--caller`, `--scope` (`packages/agentide/src/cli.ts:200-222`).
- Ticket claimed "backend-runtime enforces post-auth Origin check" — **FALSE.**
  The only enforcement code is in the simulator (`packages/agentide/scripts/
  simulate-sdk-browser.mjs:193`). The REAL enforcement is now locked in the
  adapter: W2 sub-Q4 (closed 2026-08-03) — per-token `expectedOrigins` claim,
  exact match, browser `Origin` present → claim REQUIRED, deny-by-default.
- Gateway `issueToken` mints NO `expectedOrigins` claim (`packages/gateway-core/
  src/factory.ts:161-170`). So the enforcement is locked but **no tool can mint
  a compliant token** → **drift D-50 (High)** logged. The mint side is the
  missing half.
- Adapter W2 sub-Q3 (closed) supports mid-connection token refresh via a
  re-`auth` frame with atomic claim swap.

### Locked decisions

1. **Token source — mint per page load, in-process, server-side.** The
   dashboard package (in-process with the gateway, via the composition root)
   calls the operator API `gateway.issueToken({tenantId, callerId:
   "dashboard-bot", scope: ["platform.*.read"], expectedOrigins:
   ["http://localhost:7200", "http://127.0.0.1:7200"]})` at every `GET /` and
   injects the fresh token into the served page. No localStorage paste flow,
   no operator-mint config step for normal use. The operator CLI mint
   (`agentide token issue …`) remains the documented fallback/CI path.
   Rationale: zero manual steps, fresh 1h token per load, token never persisted
   (memory only), reversible. Note: this is the operator API (same path the CLI
   uses, `cli.ts:129`) — NOT the `auth.token.issue` capability, so no
   write-scope is needed by the dashboard package itself.

2. **Origin binding — reuse the `expectedOrigins` claim (T5 Q2 permanent lock +
   adapter W2 Q4 enforcement).** **Required in-pack work:** `IssueTokenRequest`
   gains an optional `expectedOrigins?: string[]` (additive; internal dashboard
   token omits it) + CLI `--origin`/`--origins` flags. Enforcement ships in
   adapter-websocket W2 (already locked, adapter pack). Without the mint-side
   extension, NO browser client can authenticate (deny-by-default) — D-50.

3. **Scope:** `platform.*.read` is sufficient — covers `platform.dashboard.read`
   (namespace wildcard, authz.ts:95-99) and all four backing caps. No
   `dashboard.*`-specific scope string.

4. **Lifetime/refresh:** default 1h (`DEFAULT_TOKEN_TTL_MS = 3_600_000`,
   factory.ts:53). No dashboard-specific lifetime. Refresh = page reload =
   fresh mint at `GET /`. The adapter's mid-connection re-`auth` refresh (W2
   Q3) exists but is NOT used in v1 — complexity deferred until an expiry
   UX problem actually shows up (delay complexity).

5. **Localhost binding:** static server binds `127.0.0.1` (mirrors
   adapter-mcp's host default, `packages/adapter-mcp/src/types.ts:3` — local
   only). `expectedOrigins` is an ARRAY containing BOTH URL forms, so
   `http://localhost:7200` and `http://127.0.0.1:7200` both work (W2 Q4:
   multi-origin tokens supported; exact match per origin).

6. **Leak surface (accepted + documented):** worst case a leaked token grants
   read-only `platform.*.read` for ≤1h from localhost, then expires; it is
   origin-bound to the dashboard's own origin (replay on a rogue origin fails
   W2 Q4 enforcement) and lives in browser memory only. Self-hosted
   single-tenant local deployment; residual risk is explicit and traceable
   (Security Is Architecture — state it in the PRD).

### Why (philosophy alignment)

- Security is architecture: origin binding is enforced at the adapter (the
  door), the token is self-describing (deployment-portable), and the leak
  posture is explicit.
- Complexity at the edge: mint-per-load keeps the browser dumb; refresh
  complexity deferred.
- Make every decision reversible: all changes additive; per-load mint can be
  replaced by operator-mint config without touching the UI contract.
- Interfaces are forever: `IssueTokenRequest.expectedOrigins` is additive —
  no existing caller changes.

### Required work surfaced (cross-pack)

- **Mint side (this pack's IMPL):** gateway-core `IssueTokenRequest` +
  `issueToken` gain optional `expectedOrigins`; agentide CLI `token issue`
  gains `--origin`/`--origins`. Tracks drift D-50.
- **Enforcement (adapter pack):** already locked W2 Q4 (auth.error
  `origin mismatch` → 1008). Dashboard pack just consumes it.

## Progress

- 2026-08-03 — claimed (autonomous delegation); sub-questions verified against
  code (CLI flags, issueToken claims, enforcement seat); resolution above;
  CLOSED. GRILL Q8 appended; CONTEXT.md entry added; drift D-50 logged; map
  Decisions-so-far updated.
