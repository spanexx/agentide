---
slug: release-process
status: Approved
date: 2026-08-05
audience: meta/infrastructure
---

# PRD-TRD — release-process

> The "one central button" release flow. `git tag v0.0.7 && git push --tags` is the entire release. CI runs the precommit gate; `release-please` opens a Release PR; a human reviews; merging publishes to npm and attaches a GitHub Release.

> This is **meta-infrastructure**, not a runtime feature. No new types, no new events, no new public API. The deliverable is three workflow files, two config files, one PR template, an `.nvmrc`, `packageManager` pins, and a `CLI_VERSION` source-of-truth refactor.

> Source of truth for locked decisions: `docs/features/release-process/GRILL-release-process.txt` (23 Qs, locked 2026-08-05). Plan: `docs/operations/release-process.md`. Operator playbook: `.agents/skills/ci-cd-agentide/SKILL.md`.

---

## Why this exists

The repo has 14+ shipped features across 18 public npm packages (`@spanexx/*`) and one tag (`v0.0.3`). Code is at `0.0.6`. The gap between code and tags is the visible symptom of a deeper problem: **release is a hand-edit, not a button**.

What's broken today:
- `packages/agentide/package.json` and `packages/agentide/src/cli.ts:39` carry the same version (`CLI_VERSION`) — drift when one is bumped without the other (manual pair-edit).
- `2c92594 chore: restore workspace deps after publish drift` is the canonical failure mode — `prepare-publish.sh` mutates `package.json` and the mutation got committed.
- 14 commits between `v0.0.3` and `v0.0.6` were never tagged. Operators can't reconstruct what shipped when.
- No PR gate. Precommit is local discipline. The browser-runtime flake pattern (`packages/browser-runtime/src/__tests__/runtime.test.ts:551`) would survive any merge.
- No NPM publish automation. Releases happen by hand, with the failure mode visible in `2c92594`.

Cost of leaving unsolved: every release is a 30-minute manual ritual + a non-trivial chance of a `npm unpublish` call. Operators defer releases. The codebase accumulates uncommitted-shipped work.

---

## Behavioral Spec

### Scenario 1: Operator cuts a release

**Given** `main` is green (precommit + tests pass locally), the operator has push access to the repo, and `NPM_TOKEN` is set in GitHub secrets
**When** they run `git checkout main && git pull --rebase && git tag v0.0.7 && git push --tags`
**Then** within 30s, `release-please`'s bot opens a Release PR titled `chore(main): release v0.0.7` listing per-package version bumps and per-package CHANGELOG sections. The PR is the human gate (Q8).

### Scenario 2: Reviewer merges the Release PR

**Given** the Release PR is open and a reviewer has main write permission
**When** they click Squash and merge
**Then** the merge triggers `release.yml`. The workflow runs `pnpm -r publish --access public --no-git-checks`, undoes the `prepare-publish.sh` mutation with `git checkout -- packages/agentide/package.json`, and attaches a GitHub Release with the merged CHANGELOG as the body. The tag `v0.0.7` is created.

### Scenario 3: Operator verifies the release

**Given** the workflow has finished
**When** they run `npm view @spanexx/agentide version`
**Then** it returns `0.0.7`. `npm view @spanexx/gateway-core version` returns the bumped version (if touched). The GitHub Releases page shows `v0.0.7` with the merged CHANGELOG body.

### Scenario 4: Operator retro-tags missed releases

**Given** the v0.0.3 → v0.0.6 gap (Q2 — `agentide` went 0.0.4 → 0.0.6 directly, no 0.0.5 bump commit)
**When** they run `git tag -a v0.0.4 -m "v0.0.4: --version flag shipped" 944deff && git tag -a v0.0.6 -m "v0.0.6: workspace deps restored, pub pipeline hardened" 833a8de && git push --tags`
**Then** `git tag` shows `v0.0.3, v0.0.4, v0.0.6, v0.0.7` (no v0.0.5 — no bump commit exists). Subsequent `release-please` runs compute v0.0.7's CHANGELOG from `v0.0.6..HEAD` (the 14 commits since the manual release).

### Scenario 5: Contributor opens a PR

**Given** a contributor has a feature branch
**When** they push and open a PR
**Then** CI runs three required checks in parallel: `ci / precommit` (the existing local gate), `ci / pr-template` (CI-enforced field check), `ci / build` (tsc --build). The PR template's `What`, `BI link`, and `Drift status` fields are enforced. The `Sim status` field is human-enforced. Branch protection blocks merge until all three required checks are green.

### Scenario 6: Contributor pushes a docs-only change

**Given** a touch only `docs/**/*.md` (no TS source)
**When** they push
**Then** all three required checks pass. CI runs in ~5 minutes (lint runs on docs-only inputs, build runs the full `tsc --build` chain — false positive risk but rare). The reviewer sees the diff is `docs/CONTEXT.md -1 +1` and approves. No docs-only fast path (Q18).

### Scenario 7: Operator runs the npm token setup

**Given** the operator has npm org admin access
**When** they navigate to https://www.npmjs.com/settings/agentide-bot/tokens/granular-access-tokens/new and create a Granular Token (name: `agentide-bot-publish`, scope: `@spanexx`, permissions: Read+Publish, Bypass 2FA ✅, no IP allowlist), then add it to GitHub repo Settings → Secrets and variables → Actions → New repository secret (Name: `NPM_TOKEN`)
**Then** any workflow that references `${{ secrets.NPM_TOKEN }}` validates the secret at startup. The first `release.yml` run uses the token to publish.

### Scenario 8: Authoring a breaking change

**Given** a contributor's change is breaking (a public API rename)
**When** they commit `feat(gateway-core)!: rename issueToken to issueTokenV2`
**Then** `release-please` bumps `@spanexx/gateway-core` from `0.0.x` to `1.0.0` (the `!` triggers a major bump). The Release PR's CHANGELOG flags the breaking change. The reviewer (Q8) sees the major bump and can edit the PR if the contributor overbumped.

### Scenario 9: Push to main with no release-worthy commits

**Given** a contributor lands a `docs:` or `chore:` commit
**When** they push to `main`
**Then** `release-please` analyzes the commits. `determineReleaseTypes` returns `[]` for no `feat:`/`fix:`/`feat!:`. No Release PR is opened. The push stays clean (Q16).

### Scenario 10: Manual publish fallback (CI broken)

**Given** the automated pipeline is broken and a release is urgent
**When** the operator runs `cd packages/agentide && bash scripts/prepare-publish.sh && npm publish --access public && git checkout -- package.json`
**Then** the package publishes. The mutation-revert step prevents the next commit from carrying the empty `dependencies`. The `release-please` bot's next run notices the published version and aligns.

---

## Simulation Contract

This is a meta-feature. The "sim" is the end-to-end release run, not a Node script. The post-impl verification is:

```bash
# PR-1 is validated when:
cd agentide && npm run precommit                                  # → green
node packages/agentide/scripts/simulate-client-credentials.mjs     # → 7/7 PASS (no regression)
# GitHub: open PR-1, observe ci.yml green

# PR-2 (the actual release) is validated when:
git tag -a v0.0.6 -m "v0.0.6: workspace deps restored, pub pipeline hardened" 833a8de
git push --tags                                                    # → no error
# GitHub: release-please bot opens Release PR within 30s
# Reviewer merges the PR
# workflow runs: pnpm -r publish
npm view @spanexx/agentide version                                 # → 0.0.7 (or bumped value)
# Verify no package.json mutation in repo:
git status                                                        # → clean
```

The seven `packages/agentide/scripts/simulate-*.mjs` files are the regression suite. The new CI workflow runs them all on PRs (non-blocking initially, Q7).

---

## Technical Design

### File surface

| File | Purpose |
|---|---|
| `.github/workflows/ci.yml` | PR + push-to-main: precommit gate. Parallel jobs (`precommit`, `pr-template`, `build`). Node 22.10.0 from `.nvmrc`. pnpm via `corepack`. |
| `.github/workflows/sim.yml` | PR: walks `packages/agentide/scripts/simulate-*.mjs`, runs each, posts PR comment with pass count. Non-blocking (Q7). |
| `.github/workflows/release.yml` | push to `main`: `googleapis/release-please-action@v4`. On Release PR merge: `pnpm -r publish --access public --no-git-checks`, then `git checkout -- packages/agentide/package.json`. |
| `.github/release-please-config.json` | 18 packages (Q9). `changelog-sections` per plan. `release-type: node`. |
| `.github/release-please-manifest.json` | Auto-created by release-please on first run. Tracks per-package version state. |
| `.github/CODEOWNERS` | 5 GitHub teams per area (Q17). Forward-pointing; teams can be created later. |
| `.github/PULL_REQUEST_TEMPLATE.md` | 4 fields (Q5): `What`, `BI link` (required + CI-enforced), `Drift status` (required + CI-enforced), `Sim status` (required + human-enforced). |
| `.github/labeler.yml` | Auto-apply `feature`/`chore`/`fix`/`docs` labels by PR title prefix. |
| `.nvmrc` (root) | `22.10.0` (Q11). Pinned Node version. |
| `agentide/package.json` | Add `"packageManager": "pnpm@<version>"` field (Q10). |
| `packages/agentide/package.json` | Same `packageManager` field. `bundle` script gets `--define:CLI_VERSION=\"$(node -p 'require(\"./package.json\").version')\"` (Q3). |
| `packages/agentide/src/cli.ts:39` | `const CLI_VERSION = "0.0.6"` → `declare const CLI_VERSION: string;` (TypeScript-only, erased by esbuild). |
| `docs/operations/release-process.md` | The plan (Phase 0 artifact, already written). |
| `docs/features/release-process/{GRILL,PRD-TRD,IMPL}-release-process.{txt,md,md}` | The pack docs. |

### Architectural decisions (locked in GRILL)

- **Tooling:** `release-please` (Q1) over `changesets`. Pure bot, no per-PR file requirement.
- **Tag:** monorepo `v0.0.7` (Q20) with per-package versions in their own `package.json`. One tag per release.
- **Auth:** `NPM_TOKEN` GitHub secret, Granular Access Token scoped to `@spanexx` (Q6). Auto-Bypass 2FA, no IP allowlist.
- **Version source:** `package.json` is the single source (Q3). `CLI_VERSION` is replaced by esbuild `--define` at bundle time. No two-place edit.
- **CLI bundle mutation:** `git checkout -- packages/agentide/package.json` after publish (Q14). The runner is ephemeral; the repo never carries the mutation.
- **Branch protection:** PR + checks + approval (Q13). Required checks: `ci / precommit`, `ci / pr-template`, `ci / build`. Admin can override.
- **CJS variants:** auto-mirror to ESM counterpart via post-processing step in `release.yml` (Q22). CJS CHANGELOG is a 1-line pointer to the ESM counterpart (Q23).
- **PR template:** 4 fields, 3 CI-enforced (Q5). `Sim status` is human-enforced.
- **Sim:** non-blocking v1, re-evaluate after one sprint (Q7).

### Dependencies

This pack adds **zero new runtime dependencies**. The only new tool is `release-please` (the GitHub Action `googleapis/release-please-action@v4`), which is a GitHub-Actions-side tool, not a runtime dep.

For `release-please` itself:
- **License:** Apache-2.0
- **Maintenance:** Active (Google-owned, regular releases)
- **Why:** canonical "one button" release for monorepos with conventional commits
- **Alternatives:** `changesets` (per-PR file required, rejected Q1), custom workflow (too much YAML, rejected Q21)

### Branch strategy

- `main` is the release branch. Commits here are potentially shippable.
- `feature/<slug>` branches PR into `main`. Squash-merge.
- `release-please` bot pushes the Release PR directly to `main` (after a human squash-merges it).
- Force-pushes to `main` blocked by branch protection (Q13).

---

## Non-Goals

- **Docker/CD.** No Dockerfile in repo. If a hosted image becomes a goal, separate pack.
- **Trusted publishing (OIDC).** Static `NPM_TOKEN` for v1. OIDC migration is a follow-up.
- **Auto-merge for Release PR.** Human gate (Q8). Auto-merge is a follow-up if the human review wastes time.
- **Drift review on PR.** Stub for now (Q15). Real drift review in CI is a separate pack.
- **Skip-ci label.** Every PR runs the full pipeline (Q18). No docs-only fast path.
- **Multi-tenancy of releases.** All packages release on the same tag cadence (Q20). Independent cadence is a follow-up.
- **Per-package security advisories.** Out of scope; npm does that automatically.
- **Dependabot / Renovate.** Defer. The repo is small enough that manual upgrades work.
- **Custom CI runners.** Use `ubuntu-latest` (Q19). Custom runners are a follow-up if Linux GPU/Windows is needed.

---

## Out of Scope (Future)

- `pnpm audit` integration in CI (Q26 — follow-up after v0.0.7).
- Tier-aware `CODEOWNERS` enforcement (require owner approval, not just assign).
- Bump Cadence documentation in README.
- Webinar/video walkthrough of the release process.

---

## References

- `docs/features/release-process/GRILL-release-process.txt` — 23 locked decisions, the why
- `docs/operations/release-process.md` — the original plan, kept in sync
- `.agents/skills/ci-cd-agentide/SKILL.md` — the operator playbook (commands, recipes, file paths)
- `docs/Feature_Backlog.md` — row 30 (release-process) slated after the agentide-client-credentials row
- `docs/drift.md` — D-70 through D-74 cover the release process
- `packages/agentide/scripts/prepare-publish.sh` — the bundle's pre-publish hook (runs in `release.yml`)
- `packages/agentide/scripts/simulate-*.mjs` — the 7 regression sims (run by `sim.yml`)
- `commit 833a8de` — last manual release (`chore(release): bump to 0.0.6`)
- `commit 2c92594` — the canonical publish-drift failure mode
- `PHILOSOPHY.md` — the "replaceability test" that justifies keeping release-please as the only release path
