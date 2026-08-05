# Release Process — CI/CD for Agentide

> Operational doc. Lives outside the feature-pipeline docs because the release process
> is a one-time infrastructure investment that every shipped feature relies on, not a
> feature itself. Source of truth for: how a git commit becomes a published npm
> release.

**Status:** plan approved 2026-08-05. Implementation deferred to a `feature-pipeline`
run (BI[30] candidate — see `docs/Feature_Backlog.md` once added).

---

## TL;DR

`git tag v0.0.7 && git push --tags` → CI runs checks → `release-please` opens a
Release PR with version bumps + CHANGELOGs → merge the PR → packages publish to
npm and GitHub Releases attach. That's the whole button.

The pre-existing manual release (commit `833a8de chore(release): bump to 0.0.6`)
goes away. The dual-place edit (`packages/agentide/package.json` + `CLI_VERSION`
string in `packages/agentide/src/cli.ts:39`) goes away — version is the source of
truth, `release-please` syncs the CLI string.

---

## Where we are

Source: this repo, audited 2026-08-05.

- 14 public packages under `packages/` (`@spanexx/*`), all ESM, single surface
  (the four `*-cjs` variants were deleted by the drop-cjs-siblings pack on
  2026-08-05; `application` and `browser-runtime` are private).
- pnpm workspace, Node ≥ 22.12 (engines bumped by drop-cjs-siblings Phase 3),
  vitest, ESLint flat, `tsc --build`.
- Per-package semver (0.0.0 .. 0.0.6). Last manual release was
  `833a8de chore(release): bump to 0.0.6` (2026-08-04).
- Only **one tag** in the repo: `v0.0.3`. Code is at 0.0.6. Tags and code
  drifted.
- Commit `2c92594 chore: restore workspace deps after publish drift` shows a
  prior publish broke and was hand-patched.
- CHANGELOG.md exists for one package only (capability-registry, 5 lines).
- Conventional Commits used everywhere
  (`feat(gateway-core): …`, `fix(cli): …`, `docs: …`,
  `feat!: …` for breaking).
- Precommit script covers `check-banned-types + typecheck + lint + build`.
- No `.github/workflows/`. No CI. No CD.

## What's wrong

- **Tags lie.** Code is 0.0.6, the v0.0.4 / v0.0.5 / v0.0.6 releases never got
  tags. `git tag` gives a misleading picture of the shipped surface.
- **Release is a hand-edit.** Two places to edit (`package.json` + `CLI_VERSION`)
  in two PRs if you're not careful. Manual drift is the failure mode.
- **CHANGELOGs aren't written.** When a feature ships, the version bump
  doesn't carry a release note. Future operators can't reconstruct what changed
  between versions.
- **No PR gate.** Code merges on whatever the reviewer says. The `precommit`
  script is local discipline, not a blocking check.
- **No npm publish automation.** Releases happen by hand, with the failure
  mode visible in `2c92594`.

## Target — "one central button"

The push of a tag is the entire release. The button does:

1. CI runs the precommit gate on the tag commit.
2. `release-please` opens a Release PR listing the affected packages + their
   version bumps + per-package CHANGELOG sections (parsed from conventional
   commits since the last release of each package).
3. A human reviews the Release PR, edits if needed, merges.
4. The merge triggers publish: `pnpm -r publish --access public --no-git-checks`
   for each affected package, then attaches to a GitHub Release with the
   CHANGELOG as the body.
5. Done. Tags and code are now in sync.

---

## Decisions (locked 2026-08-05)

| Fork | Decision | Why |
|---|---|---|
| Tooling | **`release-please`** (vs `changesets`) | Pure bot — no `npx changeset` step per PR. Conventional commits already in use. `changesets` is more control but every PR adds a file; for the "one central button" goal it's the wrong shape. |
| CJS variants | CJS variants (`*-cjs`) were **deleted** by the drop-cjs-siblings pack (2026-08-05, D-75/D-76/D-77 resolved) | The four `*-cjs` trees had broken build chains and stale versions; the 14 ESM packages now ship a `require` condition and require Node ≥ 22.12 (`require(esm)` stable there) — one ESM surface covers CJS consumers. No consumers warranted keeping them. |
| v0.0.3 → v0.0.6 gap | **Retro-tag** `v0.0.6` on commit `833a8de` after the first CI run is green; the next release is `v0.0.7` | Makes the tag = code reality. A "Backfilled" note would record the gap forever; a retro-tag erases it. Precondition: CI must be green before the tag is created. |

---

## Architecture

### `.github/workflows/`

| File | Triggers | What it does |
|---|---|---|
| `ci.yml` | PR + push to `main` | Precommit gate: `check-banned-types` + `typecheck` + `lint` + `build` + `test` in parallel jobs. Node 20 + 22 matrix. pnpm cache. Required check on `main` so merges block on it. |
| `sim.yml` | PR | Walks `packages/agentide/scripts/simulate-*.mjs` and runs each. Posts a PR comment with the pass count. **Non-blocking** initially; after one sprint, make it required when the touched package has a sim. |
| `release.yml` | Push of `v*` tag | Triggers `release-please`'s configured workflow. The release PR, once merged, runs `pnpm -r publish` and attaches to the GitHub Release. |

### `.github/release-please-config.json`

```json
{
  "packages": {
    "packages/agentide": { "package-name": "@spanexx/agentide" },
    "packages/gateway-core": { "package-name": "@spanexx/gateway-core" },
    "packages/sdk-node": { "package-name": "@spanexx/sdk-node" },
    "packages/sdk-browser": { "package-name": "@spanexx/sdk-browser" },
    "packages/adapter-mcp": { "package-name": "@spanexx/adapter-mcp" },
    "packages/adapter-websocket": { "package-name": "@spanexx/adapter-websocket" },
    "packages/backend-runtime": { "package-name": "@spanexx/backend-runtime" },
    "packages/capability-registry": { "package-name": "@spanexx/capability-registry" },
    "packages/event-bus": { "package-name": "@spanexx/event-bus" },
    "packages/origin": { "package-name": "@spanexx/origin" },
    "packages/errors": { "package-name": "@spanexx/errors" },
    "packages/platform-capabilities": { "package-name": "@spanexx/platform-capabilities" },
    "packages/plugin-manager": { "package-name": "@spanexx/plugin-manager" },
    "packages/session-manager": { "package-name": "@spanexx/session-manager" }
  },
  "release-type": "node",
  "changelog-sections": [
    { "type": "feat",      "section": "Features" },
    { "type": "fix",       "section": "Bug Fixes" },
    { "type": "perf",      "section": "Performance" },
    { "type": "revert",    "section": "Reverts" },
    { "type": "docs",      "section": "Documentation", "hidden": true },
    { "type": "chore",     "section": "Miscellaneous", "hidden": true },
    { "type": "style",     "section": "Miscellaneous", "hidden": true },
    { "type": "test",      "section": "Tests",         "hidden": true },
    { "type": "build",     "section": "Build System",  "hidden": true },
    { "type": "ci",        "section": "CI/CD",         "hidden": false }
  ]
}
```

Private packages (`application`, `browser-runtime`) are intentionally **not** in
this list — `release-please` only touches packages it knows about.

### `.github/PULL_REQUEST_TEMPLATE.md`

```markdown
## What
<!-- one line -->

## BI link
<!-- docs/Features_Backlog.md#<slug> or N/A -->

## Drift status
<!-- feature-pipeline-review verdict (Major / Minor / None) — paste link to .reports/ -->

## Sim status
<!-- n/m — paste sim output or N/A -->

## Checklist
- [ ] `npm run precommit` is green locally
- [ ] D-1..D-<latest> either closed or not relevant
- [ ] If shipping a feature: SIM.md / IMPL.md gates green
```

---

## Versioning model

Per-package semver (current shape). `release-please` reads `feat` / `fix` /
`feat!` since the last release of each package and bumps accordingly:

- `fix:` → patch
- `feat:` → minor
- `feat!:` or `BREAKING CHANGE:` footer → major
- `chore:` / `docs:` / `refactor:` → no bump

The `agentide` meta-package (the CLI) goes 0.0.6 → 0.0.7 when its code changes.
`CLI_VERSION` in `packages/agentide/src/cli.ts:39` becomes a derived string
(read once from `package.json` at build time, or generated by a
`prepublishOnly` script that the build runs).

## Branching model

Already aligned via the `git-flow` skill:

- `main` is the release branch. Every commit on `main` is potentially a release.
- `feature/<slug>` branches. Squash-merge into `main`.
- The PR template + CI checks make the gate visible.
- Release PRs come from `release-please`'s bot. They're the only thing that
  pushes directly to `main` without a PR (the bot pushes the merged commit).

---

## Migration (one feature-pipeline run)

The bootstrapping pack is a feature like any other — it goes through the same
GRILL → PRD-TRD → IMPL → Implement → Drift Review loop. The pack's scope is
**non-behavioral infrastructure** (no new features, no capability changes).

### Phase 0 — pack docs

- `docs/features/release-process/GRILL-release-process.txt` (the lock decisions
  above)
- `docs/features/release-process/PRD-TRD-release-process.md`
  (the operational surface: workflows, badge, version cadence)
- `docs/features/release-process/IMPL-release-process.md`
  (the build plan: which file lands when, which gate must be green)

### Phase 1 — workflows + config

- `.github/workflows/ci.yml` (PR + push-to-main)
- `.github/workflows/sim.yml` (PR + non-blocking)
- `.github/release-please-config.json`
- `.github/PULL_REQUEST_TEMPLATE.md`
- README badge: `[![CI](https://github.com/.../workflows/ci.yml/badge.svg)](...)`

### Phase 2 — version sync

- New `scripts/sync-cli-version.mjs` (reads `package.json`, writes `CLI_VERSION`
  const). Called by `agentide`'s `prepublishOnly`.
- Existing `prepare-publish.sh` chain extended to call it.
- Test: bumping `agentide/package.json` version manually rebuilds the CLI
  with the new string.

### Phase 3 — first release (the button lights up)

- CI is green on `main`.
- Force the retro-tag `v0.0.6` on `833a8de` (the last manual release).
- Open the first `release-please` PR by tagging `v0.0.7` on the current HEAD.
- `release-please` opens a Release PR listing `agentide` 0.0.6 → 0.0.7 plus any
  other changed packages.
- Merge it. `pnpm -r publish` runs. GitHub Release attaches.
- Verify on npm: `npm view @spanexx/agentide version` = 0.0.7.

### Phase 4 — tighten sims (after one sprint)

- Make `sim.yml` required for PRs that touch a package with a
  `simulate-*.mjs`.

### Phase 5 — drift-on-PR (later)

- CI invokes `feature-pipeline-review` on PRs that touch
  `docs/features/<slug>/`. Posts the report as a PR comment. **Out of scope**
  for the initial pack.

---

## Out of scope (deferred)

- **Container/CD.** No Dockerfile in repo yet. If a Docker image becomes a goal,
  it's a separate pack (likely tied to a hosted-platform tier).
- **Public mirrors.** npm-only for now. No GitHub Packages, no Gitea.
- **Auto-merge.** Only the release PR is auto-merged. Feature PRs always need
  a human.
- **Security scanning.** `pnpm audit --audit-level high` is a follow-up after
  the first release lands.
- **Multi-tenancy of releases.** All packages release on the same tag cadence
  for now. If a package needs independent cadence, add it as a separate
  release-please config block later.
- **CJS variants drift.** Resolved 2026-08-05 by the drop-cjs-siblings pack —
  the four `*-cjs` packages were deleted; the 14 ESM packages (with `require`
  conditions, Node ≥ 22.12) are the single publish surface.

---

## References

- `docs/architecture/Agentide.md` — owner's manual for the Platform
- `docs/Feature_Backlog.md` — current feature sequence (this pack is BI[30]
  candidate)
- `docs/drift.md` — drift log (D-74 closed during this review, the trigger
  for treating the release process as a first-class surface)
- `packages/agentide/src/cli.ts:39` — `CLI_VERSION` source (becomes derived)
- `commit 833a8de` — last manual release ("chore(release): bump to 0.0.6")
- `commit 2c92594` — last manual publish fix ("restore workspace deps after
  publish drift") — the failure mode this pack eliminates
