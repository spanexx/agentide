# IMPL: mcp-tools-refresh

**Slug:** mcp-tools-refresh
**Status:** Phase 2 (IMPL drafted — pending approval)
**Date:** 2026-08-09
**PRD-TRD:** [PRD-TRD-mcp-tools-refresh.md](PRD-TRD-mcp-tools-refresh.md)
**GRILL:** [GRILL-mcp-tools-refresh.txt](GRILL-mcp-tools-refresh.txt)
**Closes:** drift D-127

## Phase Plan

Four phases. P1+P2 are the server change (one additive computation + one
handler return); P3 is the post-impl sim; P4 is the drift check + reconcile.
Each phase keeps the full adapter suite green.

### Phase 1 — fingerprint computation (translate.ts)

**Goal:** `listTools` returns the catalog version alongside the cards.

- `translate.ts` `listTools`:
  - After building `tools: McpTool[]`, serialize each card canonically
    (JSON of `{name, description, inputSchema, annotations.tier}` fields in
    the order McpTool defines them), sort by `name`.
  - `catalogVersion = createHash("sha256").update(sortedSerialization).digest("hex").slice(0, 12)`.
  - Return `{ok: true, tools, catalogVersion}` (extend `ListToolsOutcome`).
  - Unchanged: scope filtering, describe enrichment, error paths.
- No new dependencies (`node:crypto` already used in the repo).

**Tests** (translate.test.ts):
- Version stable: two `listTools` calls with an unchanged mock registry →
  identical `catalogVersion`, non-empty, 12 hex chars.
- Version changes when the registry changes (add a card between calls).
- Version is sensitive to description/schema/tier (change one field →
  version changes) and to ORDER-independence (same cards, different
  insertion order → same version).
- Existing 20 tests stay green (outcome shape extended additively).

**Validation gate:** `pnpm exec vitest run packages/adapter-mcp/src/__tests__/translate.test.ts` — 20 + new green.

### Phase 2 — wire into the tools/list handler (index.ts)

**Goal:** the wire result carries `{tools, catalogVersion}`.

- `index.ts` `ListToolsRequestSchema` handler: build
  `const {tools, catalogVersion} = outcome; return {tools, catalogVersion}`.
- Nothing else changes (auth, validateMeta-removal behavior, auto-mint
  D-126, error table — all untouched per PRD-TRD Non-goals).

**Tests** (scenarios.test.ts):
- Scenario 1 updated: result has `catalogVersion` (12-hex) and tools unchanged.
- New: same adapter + same registry + second `tools/list` → SAME version
  (stable).
- New: register a card via the registry between calls → version differs
  (simulate by constructing a second adapter with a different registry, or
  the harness's registry register).
- Narrow-token vs operator-token: different scopes → different catalogs AND
  versions; platform-only change doesn't bump the narrow caller (via the
  harness registry).
- Existing 15 scenario tests stay green (additive field).

**Validation gate:** `pnpm exec vitest run packages/adapter-mcp/src/__tests__/` — 44+ green.

### Phase 3 — post-impl simulation (simulate.sh)

**Goal:** demonstrate the PRD-TRD Simulation Contract against the real
bundled CLI + a real HTTP MCP client (curl JSON-RPC; no SDK dependency).

- `docs/features/mcp-tools-refresh/simulate.sh` (bash, mirrors sibling
  `simulate.sh` conventions: scratch data dir, PASS/FAIL echoes, exit 0 on
  full pass):
  1. Boot gateway (`agentide gateway start --data-dir <scratch> --all-doors
     --foreground`, local bundle).
  2. Mint operator token; `tools/list` → capture `catalogVersion` (V1) +
     tool count (29 platform).
  3. Second `tools/list` → same V1 (stability).
  4. Boot the example app → wait for "Registered 11 caps" → `tools/list` →
     V2 ≠ V1 + 40 tools incl. `product.list` (changes on registration).
  5. Stop the app (or wait for SDK drop) → `tools/list` → V3 ≠ V2 + 29 tools
     (changes on unregister).
  6. Narrow token (business-only) `tools/list` → its own version, business
     tools only; a platform-cap registration does NOT change it (use the
     operator token's registration events between calls).
  7. Cleanup + summary.
- Uses raw JSON-RPC POSTs (stateless door — no MCP SDK needed).

**Validation gate:** `bash docs/features/mcp-tools-refresh/simulate.sh` — all
PASS.

### Phase 4 — drift check + reconcile

- Spawn the feature-pipeline-review sub-agent: compare PRD-TRD contract vs
  implementation + sim output.
- Reconcile: this pack has no pre-impl sim (design-time sim wasn't produced
  in the GRILL phase; the GRILL IS the design record) — `simulate.sh` is the
  canonical single sim.
- D-127 → Resolved with commit ref + verification.
- CONTEXT.md "Catalog Version" glossary entry already added (GRILL Q12).

**Gate:** review output; gaps fixed or accepted + logged.

## Test Strategy

- Unit: translate.test.ts (fingerprint stability/change/per-caller), scenarios.test.ts (wire shape).
- Integration: simulate.sh against the real gateway + example app.
- Full suite + precommit stay green throughout.

## Rollout

- `fix(adapter-mcp): catalog version fingerprint on tools/list (D-127)` —
  rides the next release (agentide + adapter-mcp patch).
- Client refresh contract documented in PRD-TRD; Zed-side integration is an
  external follow-up (GRILL Q9) — noted for the operator.