# PRD-TRD: MCP Catalog Refresh

**Slug:** mcp-tools-refresh
**Status:** Draft (Phase 1 — pending user approval)
**Date:** 2026-08-09
**GRILL:** [GRILL-mcp-tools-refresh.txt](GRILL-mcp-tools-refresh.txt) (locked — appendix reference)
**Closes:** drift D-127 (docs/drift.md)
**Affects:** `packages/adapter-mcp` (server side), client integrations (documented contract)

## Why This Exists

MCP clients (Zed included) fetch the tool catalog once per connection via
`tools/list` and cache it. When the catalog changes afterward — e.g. the
example app connects and registers its 11 business capabilities — connected
clients never learn about the new tools until they reconnect or restart.
Observed live (D-127): business tools appeared only after a Zed restart.

The fix respects two locked constraints:
- **Adapters are stateless** (CONTEXT.md glossary: "pure protocol translators — no business logic, no state"; mcp-adapter IMPL Phase 3: stateless transport per BI[9] GRILL Q1). A server push (`notifications/tools/list_changed`) would require connection tracking — rejected in the GRILL (Q1).
- **The catalog is already dynamic and per-caller** (PRD-TRD-mcp-adapter Scenario 1: `tools/list` returns the current catalog, scope-filtered per BI[7]).

So the feature makes the catalog **self-describing** (version fingerprint on
`tools/list`) and defines the **client refresh contract** (re-fetch when the
version changes) — new tools appear without a manual reconnect, with zero
server state.

## Behavioral Spec

### Scenario 1: tools/list carries a catalog version

**Given** an MCP client calls `tools/list` with any valid bearer token
**When** the adapter builds the (scope-filtered) tool catalog
**Then** the result is `{tools: [...], catalogVersion: "<fingerprint>"}` where
fingerprint = sha256 over the sorted tool cards (name, description,
inputSchema, tier — the fields the cards actually carry), first 12 hex
chars. Two calls with the same scope and unchanged registry return the SAME
fingerprint.

### Scenario 2: catalog version is per-caller

**Given** an operator token (scope `*`) and a narrow token (e.g.
`customer.read`) both call `tools/list`
**Then** each gets its own scoped catalog AND its own fingerprint. A change
invisible to the narrow caller (e.g. a platform-cap registration) does NOT
change the narrow caller's fingerprint.

### Scenario 3: catalog change (registration) changes the fingerprint

**Given** a connected client cached version `a1` (29 tools); the example app
connects and registers 11 business capabilities
**When** the client calls `tools/list` again (connection, version-check, or
per-turn refresh)
**Then** the result carries a DIFFERENT fingerprint (`b2`) and the 11 business
tools are already in the response — the response IS the update, one round-trip.

### Scenario 4: catalog change (unregistration) changes the fingerprint

**Given** the example app disconnects
**When** the client calls `tools/list`
**Then** the fingerprint differs from the cached one and the business tools
are gone from the response. A subsequent `tools/call product.list` returns
`-32001 capability 'product.list' not found` (unchanged error contract).

### Scenario 5: old clients unaffected

**Given** a client that ignores unknown result fields (pre-feature behavior)
**When** it calls `tools/list`
**Then** it reads `tools` and ignores `catalogVersion` — behavior identical to
today (tools appear on reconnect). No client errors, no schema break.

### Scenario 6: auth and session handling unchanged

**Given** any caller
**When** it calls `tools/list` or `tools/call`
**Then** token verification, scope rules, auto-mint (D-126), and the error
table behave exactly as before — the fingerprint is computed after auth and
scope filtering and touches nothing else.

## Simulation Contract

The post-impl sim (`simulate.sh`) must demonstrate:

```bash
# Scenario 1: version stamp present + stable across identical calls
tools/list (token A)        # result.catalogVersion = <hex>, non-empty
tools/list (token A) again  # same catalogVersion (no registry change)

# Scenario 3: version changes when the catalog changes
boot example app            # registers 11 business caps
tools/list (token A)        # catalogVersion differs; tools now include
                            #   product.list, cart.add, ...

# Scenario 4: version changes on unregister
stop example app
tools/list (token A)        # catalogVersion differs again; business tools gone

# Scenario 2 (per-caller): narrow token's version is independent
tools/list (narrow token)   # its own fingerprint; platform-only registrations
                            #   do NOT bump it
```

## Technical Design

### Server change (adapter-mcp)

- `translate.ts` `listTools`: after building the `McpTool[]` cards, compute
  `catalogVersion` = sha256 over the canonical serialization of the sorted
  cards (sort by `name`, include `name`, `description`, `inputSchema`,
  `annotations.tier`), truncated to 12 hex chars.
- `index.ts` `ListToolsRequestSchema` handler: return
  `{tools: outcome.tools, catalogVersion: outcome.catalogVersion}`.
- Compute-on-demand per request (GRILL Q7): no events, no persisted state,
  no registry wiring.
- No changes to `tools/call`, auth, sessions, or the error table (GRILL Q11).

### Client contract (documented here; client implementation is external)

A conforming MCP client re-fetches `tools/list` when ANY of:
1. It connects/reconnects (baseline, today's behavior).
2. A `tools/call` returns `-32001 capability '<name>' not found` for a name
   present in its cached catalog — re-fetch once, then retry.
3. It observes a `catalogVersion` different from its cached value (the
   response carrying it IS the fresh catalog — no second round-trip).
4. (Recommended) at the start of each new agent turn — one light request per
   turn, no polling between turns.

The client treats `catalogVersion` as OPAQUE: compare for equality only,
never ordering/arithmetic.

### Data models

```ts
// McpTool unchanged; tools/list result gains one field:
interface ListToolsResult {
  tools: McpTool[];
  catalogVersion: string; // sha256(sorted cards)[0..12]
}
```

### Dependency analysis

- `node:crypto` `createHash` — already used elsewhere in the repo
  (`data-dir.ts` repoKey uses the same pattern).
- No new dependencies, no new packages, no new event surface.

## Non-goals

- No server push / `notifications/tools/list_changed` (rejected GRILL Q1 —
  would require connection state).
- No capability-registry event wiring (none exists; compute-on-demand
  obviates it).
- No changes to `tools/call`, error codes, auth, or session handling
  (GRILL Q11).
- No changes to the WS door or CLI consumer.
- No client-side auto-reconnect logic shipped from this repo — the contract
  is documented; the Zed-side integration is operator-enabled (GRILL Q9).
- No CONTEXT.md glossary aside from the locked "Catalog Version" entry
  (GRILL Q12).

## Appendix: GRILL

All design decisions locked in `GRILL-mcp-tools-refresh.txt` (12 entries)
— referenced, not duplicated.