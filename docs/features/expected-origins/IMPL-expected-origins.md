# IMPL — expected-origins (mint-side `expectedOrigins`)

**Status:** Approved 2026-08-03 (grill-lite locked; PLAN.md §4-8 is the detailed spec)
**Closes drift:** D-50
**Canonical detail:** `PLAN.md` in this directory (flag spec §5, edge cases §6, risks §7, conventions §8)

## Phase map

| Phase | Files | Gate |
|---|---|---|
| 0 grill-lite | `GRILL-expected-origins.txt` | DONE (committed `docs(expected-origins): grill-lite`) |
| 1 gateway-core | `packages/gateway-core/src/types.ts` (`IssueTokenRequest.expectedOrigins?`, line ~189), `packages/gateway-core/src/factory.ts` (claim spread at `issueToken` closure ~164 + `auth.token.issue` handler ~278), new `packages/gateway-core/src/__tests__/issue-token.test.ts` (6 tests) | `pnpm exec vitest run packages/gateway-core` green |
| 2 CLI | `packages/agentide/src/cli.ts` (array-capable `parseArgs` flags + `getFlagAll` + `getFlag` last-element fallback + HELP + `runToken` parse/pass), `packages/agentide/src/__tests__/cli.test.ts` (7 tests) | `pnpm exec vitest run packages/agentide` green |
| 3 sim + docs | `packages/agentide/scripts/simulate-websocket-adapter.mjs` (S4b block), `packages/agentide/scripts/sim-state.mjs` (recordAudit channel param), `docs/drift.md` (D-50 close), `docs/Feature_Backlog.md` (rows 24/13), `docs/CONTEXT.md` (decision-log entry) | sim PASS; drift header counts updated |
| 4 verify + commit | full suite, precommit chain, 5 commits | `pnpm precommit` green; sim PASS |

## Key implementation notes

- **Phase 1:** claim spread copies the array (`[...req.expectedOrigins]`) —
  mutation-after-mint must not change the minted claim. Capability handler
  input arrives JSON-round-tripped via `wrap` → use `Array.isArray` guard.
  `verifyToken` parses the payload wholesale — nothing strips the field.
- **Phase 2:** `parseArgs` is currently last-wins (cli.ts:63). Promote repeated
  string flags to arrays; `getFlag` returns the LAST element (backward compat
  for `--scope`/`--tenant`/`--caller`); new `getFlagAll` returns all.
  `runToken`: union `getFlagAll(origin)` + `getFlag(origins).split(",")`,
  trim, drop empty, dedupe via `new Set`; empty → omit field entirely.
  Line budget: cli.ts 304 → ~335 (under 350).
- **Phase 3:** S4b must mint through the REAL CLI path — boot platform and CLI
  against the SAME in-memory fs instance (shared seeded `gateway-secret`),
  then assert: exit 0, JWT payload carries the claim, matching-origin socket
  gets `auth.ok`, mismatched socket gets `auth.error origin mismatch` + 1008.
  `sim-state.mjs` `recordAudit` gains a `channel` parameter (default `"mcp"`
  for backward compat); ws sim passes `channel: "websocket-adapter"`.
  D-50 moves to Resolved (format mirroring D-51) with `Verified by:` citing
  types.ts / factory.ts / cli.ts / tests / sim S4b; header `Open: 9 → 8`,
  `Resolved: 34 → 35`, `Critical/High: 2 → 1` (note: D-53/D-54 added Open
  entries after PLAN was written — recount from the live file).
- **Phase 4:** commit sequence (style `type(scope): subject`):
  1. `docs(expected-origins): grill-lite …` — DONE
  2. `feat(gateway-core): mint expectedOrigins claim via issueToken + auth.token.issue`
  3. `feat(agentide): token issue gains repeatable --origin and --origins flags`
  4. `feat(expected-origins): sim S4b — CLI-minted origin-bound token e2e (match ok / mismatch 1008)`
  5. `docs(expected-origins): close drift D-50; update backlog rows 24/13 + CONTEXT.md decision log`
  Never commit `data/sim-state.json` residue (pre-existing, AGENTS.md rule −1).

## Risks

1. `getFlag` repeat-flag limitation — resolved (array-capable parser, backward compat).
2. `factory.ts` 545 lines (pre-existing, over 350 rule) — not split (non-goal).
3. S4b timing — `nextMessage` 2000ms ample for in-process CLI mint; bump to 4000ms if flaky.
4. `data/sim-state.json` dirty before this work — do not revert/commit without asking.
