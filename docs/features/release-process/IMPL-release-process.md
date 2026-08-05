---
slug: release-process
status: In Progress
date: 2026-08-05
---

# IMPL: release-process

Phase order for the `release-process` pack. Sibling to `PRD-TRD-release-process.md`. Companion: `.agents/skills/ci-cd-agentide/SKILL.md`.

**Two-PR architecture (Q1, locked):** PR-1 lands the workflow infrastructure on `main` (no tag, no publish). PR-2 retro-tags the missed releases (`v0.0.4`, `v0.0.6`) and cuts the first release via the new pipeline (`v0.0.7`).

---

## Phase 0 — pack docs

**Build:**
- `docs/features/release-process/GRILL-release-process.txt` — 23 locked Qs ✅ (already exists)
- `docs/features/release-process/PRD-TRD-release-process.md` — behavioral spec ✅ (just approved)
- `docs/features/release-process/IMPL-release-process.md` — this file (you are here)
- `docs/operations/release-process.md` — the operator-facing plan ✅ (already exists)

**Verify:**
- [ ] All three GRILL/PRD-TRD/IMPL files exist in `docs/features/release-process/`
- [ ] `docs/operations/release-process.md` indexed via `docs/Architecture.md` if it exists, otherwise linked from `README.md`

**Blocked by:** nothing.

---

## Phase 1 — contributor hygiene (works without GitHub)

The inner monorepo tooling fixes. No GitHub, no secrets. Lands as a single PR.

**Build:**
- `agentide/.nvmrc` → `22.13.1` (Q11, raised during PR-21 sanity check — pnpm 11.10.0's runtime requires Node 22.13+; the original `22.10.0` pin failed `pnpm install --frozen-lockfile` on a fresh runner with "This version of pnpm requires at least Node.js v22.13")
- `agentide/package.json` → add `"packageManager": "pnpm@<lockfile-version>"` (Q10); read version via `pnpm --version` after `corepack enable`
- `packages/agentide/package.json` → same `packageManager` field (Q10)
- `packages/agentide/src/cli.ts:39` → `const CLI_VERSION = "0.0.6"` becomes `declare const CLI_VERSION: string;` (Q3, TypeScript-only, erased by esbuild)
- `packages/agentide/package.json` → extend `bundle` script with `--define:CLI_VERSION=\"$(node -p 'require(\"./package.json\").version')\"` (Q3)
- `scripts/check-banned-types.sh` → already present, no changes

**Verify:**
- [ ] `cd agentide && npm run precommit` → green (no lint/typecheck regression)
- [ ] `cd agentide && npm test` → green (still 988/989)
- [ ] After bumping `packages/agentide/package.json` to `0.0.7-test` and rebuilding: `node packages/agentide/dist/bin.bundled.cjs --version` reports `0.0.7-test` (or skip — verify with `git diff` showing the source `CLI_VERSION` is `declare const`)
- [ ] `pnpm install` (with `corepack enable`) succeeds; `pnpm` version matches `packageManager` field
- [ ] `node --version` matches `.nvmrc`'s `22.10.0`

**Blocked by:** nothing.

---

## Phase 2 — GitHub-side infrastructure

The new files. Builds on Phase 1's `packageManager` field (now `pnpm install` in CI works without a corepack version drift).

**Build:**
- `agentide/.github/` — create the directory
- `agentide/.github/workflows/ci.yml` — PR + push-to-main job. 3 parallel jobs (`precommit`, `pr-template`, `build`). `actions/setup-node@v4` with `node-version-file: .nvmrc`. `corepack enable` before `pnpm install`. `actions/checkout@v4` with `fetch-depth: 0` (so release-please sees tags).
- `agentide/.github/workflows/sim.yml` — PR job. `continue-on-error: true`. Walks `packages/agentide/scripts/simulate-*.mjs`, runs each, posts a PR comment with `n/m PASS`. Non-blocking (Q7).
- `agentide/.github/workflows/release.yml` — push to `main` OR push of `v*` tag. `googleapis/release-please-action@v4` reads `release-please-config.json`. On Release PR merge: job runs `pnpm -r publish --access public --no-git-checks` then `git checkout -- packages/agentide/package.json` (Q14). (Trigger widened from `branches: [main]` to `branches: [main] + tags: ['v*']` during PR-21 sanity check — the IMPL Phase 5 expectation "git tag → push --tags → release-please opens PR" requires tag-triggered runs, not just main pushes.)
- `agentide/.github/release-please-config.json` — 18 packages (Q9). `changelog-sections` per the plan. `release-type: node`.
- `agentide/.github/PULL_REQUEST_TEMPLATE.md` — 4 fields (Q5): `What` (free text), `BI link` (required + CI-enforced via regex), `Drift status` (required + CI-enforced), `Sim status` (required + human-enforced).
- `agentide/.github/CODEOWNERS` — 5 teams per area (Q17): `gateway-core-maintainers`, `cli-maintainers`, `sdk-maintainers`, `adapter-maintainers`, `agentide-maintainers`. Forward-pointing; teams can be created later.
- `agentide/.github/labeler.yml` — auto-apply `feature`/`chore`/`fix`/`docs` labels by PR title prefix.

**Verify (locally before committing):**
- [ ] `actionlint` (if available) — no syntax errors in any `*.yml`
- [ ] `node -e "JSON.parse(require('fs').readFileSync('agentide/.github/release-please-config.json'))"` — JSON valid
- [ ] `cat agentide/.github/PULL_REQUEST_TEMPLATE.md` — 4 headings present
- [ ] Manual: each `*.yml` references the right action versions (`@v4`)

**Verify (after PR-1 lands):**
- [ ] GitHub Actions runner shows 3 parallel jobs in `ci.yml`
- [ ] PR-1's `precommit` job shows green ✓
- [ ] PR-1's `pr-template` job shows "all required fields present" ✓
- [ ] PR-1's `build` job shows `tsc --build` clean ✓
- [ ] `sim.yml` runs on PR-1, posts comment with `n/m PASS` (n=7)
- [ ] No `release.yml` triggers on PR-1 (push-to-main only)

**Blocked by:** Phase 1 (the `packageManager` pin), an operator with GitHub branch-protection admin access (Q13), and an operator with npm org admin access (Q6 — the `NPM_TOKEN` setup).

---

## Phase 3 — branch protection (the manual setup that gates everything)

Not a Git commit — a GitHub UI change. Done by an operator with repo admin access.

**Build:**
- GitHub repo → Settings → Branches → Add rule for `main`.
- ✅ Require a pull request before merging. Dismiss stale approvals. Require approvals: 1.
- ✅ Require status checks to pass before merging. Required: `ci / precommit`, `ci / pr-template`, `ci / build`.
- ✅ Do not allow force pushes.
- ✅ Do not allow deletions.
- (The `sim` check is excluded from required per Q7.)
- Optional: `npm_TOKEN` setup at repo Settings → Secrets and variables → Actions. New repository secret. Name: `NPM_TOKEN`. Value: the Granular Token from https://www.npmjs.com/settings/agentide-bot/tokens.

**Verify:**
- [ ] A test PR (e.g., a typo in `docs/CONTEXT.md`) shows the 3 required checks
- [ ] Squash-merging the PR is blocked until all 3 are green
- [ ] Force-push to `main` is rejected by GitHub
- [ ] `releases/canary` (or any non-`main` branch) is unaffected

**Blocked by:** Phase 2 (the checks must exist before they can be made required).

---

## Phase 4 — PR-1 lands (the workflow infra)

A PR is opened that bundles Phase 1 + Phase 2 file changes. CI runs the new workflows against this PR. Once green, squash-merge into `main`.

**Build:**
- PR titled `chore(infra): release-process pack — workflow files + pinning (BI[30])`
- PR body filled per the new template (`What`, `BI link`, `Drift status`, `Sim status`)
- The PR **does NOT** include any `package.json` version bump
- The PR **does NOT** push any tag

**Verify:**
- [ ] CI runs Phase 2's workflows against this PR
- [ ] All 3 required checks green
- [ ] `sim.yml` posts the pass count
- [ ] Branch protection allows the squash-merge
- [ ] After merge: `git log -1 main` shows the PR-1 commit
- [ ] Phase 3 (manual branch protection) is now enforceable

**Blocked by:** Phase 2 + Phase 3.

---

## Phase 5 — PR-2 retro-tags + first release (the button lights up)

PR-1 is on `main`. Now the operator runs the actual release flow.

**Build:**
- A PR is opened that bumps no code, but the PR description says "this is the prep PR for v0.0.7 — once merged, operator runs the tag push."
- Operator checks out `main`, pulls, runs:
  ```bash
  git tag -a v0.0.4 -m "v0.0.4: --version flag shipped" 944deff
  git tag -a v0.0.6 -m "v0.0.6: workspace deps restored, pub pipeline hardened" 833a8de
  git push --tags
  ```
- `release-please` action runs (Q21). Within 30s, the bot opens a Release PR titled `chore(main): release v0.0.7`. The PR's diff: 4 packages bumped (per the commit log: `gateway-core`, `agentide`, `adapter-mcp`, `sdk-node` — see PRD-TRD §Behavioral Spec Scenario 1).
- Reviewer (Q8 — human gate) reviews the PR's version bumps and CHANGELOGs. Edit if needed. Squash-merge.
- `release.yml` runs `pnpm -r publish --access public --no-git-checks`, then `git checkout -- packages/agentide/package.json`. GitHub Release attaches.

**Verify:**
- [ ] `git tag` shows `v0.0.3, v0.0.4, v0.0.6, v0.0.7`
- [ ] `npm view @spanexx/agentide version` → `0.0.7`
- [ ] `npm view @spanexx/gateway-core version` → `0.0.3` (or bumped value)
- [ ] GitHub Releases page shows `v0.0.7` with the merged CHANGELOG as body
- [ ] `git status` on `main` is clean (no `package.json` mutation)
- [ ] `packages/agentide-cli/CHANGELOG.md` has a 1-line pointer entry for `0.0.6` (Q23)

**Blocked by:** Phase 4 + an operator with npm `agentide-bot` account (Q6) + an operator with the `NPM_TOKEN` secret already set.

---

## Phase 6 — sim → required (after one sprint, Q7)

Two weeks after v0.0.7 ships. Track regressions the post-impl sims caught vs PR review missed.

**Build:**
- If regressions caught ≥1: flip `sim.yml` to `continue-on-error: false` (becomes required). Update `ci.yml`'s required checks list to include `ci / sim`.
- If zero regressions: keep `sim.yml` non-blocking. Document the decision in the retro.

**Verify:**
- [ ] A PR with a deliberate regression in a touched-package sim fails the `ci / sim` check
- [ ] Branch protection blocks the merge with the failing check
- [ ] Backlog updated: `update-backlog` skill marks the release-process row as SHIPPED (Q15 follow-up)

**Blocked by:** Phase 5 + one sprint of post-release observations.

---

## Test Strategy

This is a meta-infrastructure pack. There are no `__tests__/` files. The verification is the end-to-end release run itself.

**Local verification:**
- `npm run precommit` (Q1, Phase 1)
- `npm test` (regression: 988/989 expected)
- `node packages/agentide/scripts/simulate-*.mjs` (all 7 sims, n/m PASS)

**CI verification:**
- Each PR's 3 required checks (`precommit`, `pr-template`, `build`)
- Each PR's `sim.yml` (non-blocking, but visible)

**End-to-end verification:**
- Tag push → release PR opens (Q21)
- Release PR merge → publish + GitHub Release (Q21)
- `npm view` for both the bumped CLI and the bumped SDK

**Manual verification:**
- `npm view @spanexx/agentide version` after first release

---

## Dependency Analysis (opensrc)

This pack adds **zero new runtime dependencies**. The only new tool is `release-please` (the GitHub Action `googleapis/release-please-action@v4`).

For `release-please`:
- **License:** Apache-2.0
- **Maintenance:** Active (Google-owned, weekly releases)
- **Why:** canonical "one button" release for monorepos with conventional commits
- **Alternatives:** `changesets` (rejected Q1), custom workflow (rejected Q21)
- **Call pattern:** `uses: googleapis/release-please-action@v4` with `with: config-file: .github/release-please-config.json, manifest-file: .github/release-please-manifest.json`

For `actions/setup-node@v4` and `actions/checkout@v4`:
- These are GitHub's own actions. No third-party deps.

For `pnpm` (already in use):
- No version change. Phase 1 pins via `packageManager` field.

---

## Rollout

This is a one-shot pack. PR-1 introduces infra. PR-2 lights the button. By the end of Phase 5, the entire team is using the new pipeline. No flag flips, no migration.

- **Operator-level rollout:** PR-1 must be reviewed by an admin who can apply the branch-protection rules (Phase 3). The admin also needs to set the `NPM_TOKEN` secret.
- **Contributor-level rollout:** contributors open PRs against the new template. The 4 fields become required. The PR template is the only contributor-facing change.
- **External rollout:** npm packages publish at v0.0.7. Consumers see the new version on `npm view`. The CHANGELOG is the source of truth.

---

## Risk Notes

| Risk | What's affected | Mitigation |
|---|---|---|
| Phase 1 breaks the local precommit | Every contributor's `git commit` | Run `npm run precommit` locally before pushing PR-1. |
| `release-please-config.json` miscounts bumps | Wrong package versions | Start with the canonical 18-package list. Verify the first Release PR's diff against the commit log. |
| `NPM_TOKEN` expired mid-publish | First release fails | Automation tokens don't expire. Document the rotate procedure in the skill. |
| Branch protection misconfigured | Required checks don't fire | Test with a typo PR before merging PR-1. |
| Contributor adds a dep without `opensrc` analysis | License violation | The existing `precommit` doesn't catch this. Add `pnpm license` (or manual review) to future sprints. |
| CJS variant drift | Consumers on `@spanexx/agentide-cjs` see stale version | Phase 5's release.yml post-processing mirrors ESM bumps. Verify with `npm view @spanexx/agentide-cjs version` after first release. |
| `2c92594`-style failure (mutation committed) | Workspace breaks | Q14: `git checkout -- packages/agentide/package.json` after publish. The runner is ephemeral. |
| First release-please run flags too many/no packages | Wrong version jumps | The human gate (Q8) catches this. Reviewer can edit the PR's package list. |
| `.nvmrc` mismatch with `@types/node` pin | npm install fails | `.nvmrc: 22.10.0` and `@types/node: ^22.10.0` align. Verify before Phase 1. |
| `gh` CLI not installed | Operator can't run `gh release create` | Not needed — the GitHub Action creates the release. Skip. |
| Pre-impl sim skipped | Design flaws surface during implementation | Per the user's "approved" on the PRD-TRD, the pre-impl sim is folded into the IMPL phases themselves. The 6 phases surface the same kinds of issues. |

---

## Status Updates

After each phase, mark it inline:

- [x] Phase 0 — pack docs (2026-08-05)
- [x] Phase 1 — contributor hygiene (2026-08-05)
- [x] Phase 2 — GitHub-side infrastructure (2026-08-05; local verify only — GitHub runner verify is post-PR-1)
- [ ] Phase 3 — branch protection (manual, blocked on operator)
- [ ] Phase 4 — PR-1 lands (blocked on operator push + GitHub Admin)
- [ ] Phase 5 — PR-2 retro-tags + first release (blocked on Phase 4)
- [ ] Phase 6 — sim → required (sprint after v0.0.7)
- [ ] Phase 3 — branch protection (manual)
- [ ] Phase 4 — PR-1 lands
- [ ] Phase 5 — PR-2 retro-tags + first release
- [ ] Phase 6 — sim → required (sprint after v0.0.7)

After Phase 5 completes, run `update-backlog` skill to mark the release-process row as SHIPPED.
