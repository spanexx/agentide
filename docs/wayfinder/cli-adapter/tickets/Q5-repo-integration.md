# Q5 — Repo integration: crate location, precommit, CI

**Type:** `wayfinder:grilling` (HITL)
**Status:** **closed** (2026-08-03, autonomous under user delegation)
**Blocks:** nothing — implementation logistics, locked with Q3/Q4

## Question

Where does the Rust crate live in this pnpm/TS monorepo, and how do the
repo's checks (precommit, CI) cover it? The `precommit` script today is
TS-only: `check-banned-types && typecheck && lint && build`
(`agentide/package.json:11`). No GitHub Actions workflow exists anywhere
in the repo (checked `.github/workflows` — none).

## What I know

- pnpm workspace (`pnpm-workspace.yaml`) globs `packages/*` for TS
  packages. A cargo crate inside `packages/` would be scanned and
  mis-detected.
- GRILL notes said "CLI lives in a Rust crate OUTSIDE the npm workspaces
  (e.g. `packages/cli-adapter/` as cargo crate)" — the intent is
  "outside the npm workspace", the example path was a placeholder.
- `precommit` is the only gate (no CI workflow exists). It must not fail
  on machines without the Rust toolchain (TS-only contributors).
- The binary name is `platform` (Q1 lock). Distribution (cargo install /
  Homebrew / raw binary) is explicitly out of v1 (future.md).

## Sub-questions

1. Crate directory: `crates/cli-adapter/` (new top-level dir beside
   `packages/`) vs `packages/cli-adapter/` (pnpm would try to treat it as
   a TS package)?
2. Precommit: new `scripts/precommit-rust.sh` chained into the existing
   `precommit` script — `cargo fmt --check && cargo clippy -- -D warnings
   && cargo test` in the crate dir. Skip (warn, exit 0) if cargo is
   missing; fail hard on real check failures.
3. CI: no workflow exists — precommit is the gate. Add GitHub Actions
   later with distribution (future.md), not now?

## Resolution (locked 2026-08-03, autonomous under user delegation)

1. **Crate lives at `agentide/crates/cli-adapter/`** — a NEW top-level
   `crates/` dir beside `packages/`. Cargo package name `cli-adapter`,
   `[[bin]] name = "platform"` (the Q1-locked binary). pnpm workspace
   unaffected (only scans `packages/*`); cargo workspace ready for the
   future `platform-sdk-rust` crate (BI[22]) in the same dir. The GRILL
   note's `packages/cli-adapter/` example is superseded — this ticket
   locks the real location.

2. **`scripts/precommit-rust.sh`** (new, ships with the feature-pipeline
   pack): `command -v cargo` missing → warn + exit 0 (TS-only devs
   unaffected); else `cd crates/cli-adapter && cargo fmt --check && cargo
   clippy --all-targets -- -D warnings && cargo test`. Chained into
   `package.json` `precommit` AFTER `npm run build`:
   `... && npm run build && bash scripts/precommit-rust.sh`. `cargo build
   --release` NOT in precommit (slow; the artifact is built at release
   time — distribution is out of v1).

3. **No CI workflow in v1.** Precommit is the gate (matches repo status
   quo — no Actions exists for the TS side either). GitHub Actions + Rust
   toolchain + artifact publishing lands with the distribution decision
   (future.md).

Consequences: GRILL record (Q5); map Decisions-so-far; future.md
loose-lock reference updated. No drift — no doc-vs-code divergence.