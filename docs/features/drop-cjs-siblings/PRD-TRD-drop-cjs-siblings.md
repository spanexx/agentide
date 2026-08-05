---
slug: drop-cjs-siblings
status: Draft
date: 2026-08-05
audience: meta/infrastructure
---

# PRD-TRD — drop-cjs-siblings

> The agentide monorepo ships 14 ESM packages with 4 CommonJS siblings maintained by per-package mirror scripts. The siblings were architectural hygiene for hypothetical CJS-only consumers who never materialized. After the cjs-sdk-bootstrap pack shipped the working siblings and produced a documented plan for the broken ones (D-75 / D-76), the cost-benefit no longer justifies keeping them. Zero consumers exist today. This pack drops all four siblings, drops the mirror script chain, and bumps `engines.node` to `>=22.12` across the 14 published ESM packages so the documented reason (`require(esm)` is stable) holds for every published package.

> Source of truth for locked decisions: `docs/features/drop-cjs-siblings/GRILL-drop-cjs-siblings.txt` (7 Qs, locked 2026-08-05). Plan: this file. Operator playbook: `.agents/skills/ci-cd-agentide/SKILL.md` (post-pack).

---

## Why this exists

Three cost centers that go away with this pack:

1. **Mirror drift bugs.** The cjs-sdk-bootstrap pack spent phases 2 and 3 fixing exactly this — `sdk-node-cjs@0.0.1` shipped while ESM was on `0.1.0` for months because release-please's manifest format and the mirror script's read-format had drifted apart. The user spent a session restoring that alignment.

2. **Broken-build pair.** `sdk-browser-cjs` and `agentide-cjs` had undeclared transitive deps (logged as D-75 / D-76 in `docs/drift.md`). The "fix" would have been multi-week: build out a `backend-runtime-cjs` → `capability-registry-cjs` → ... chain, OR bundle every CJS variant to one self-contained esbuild output. Both are large.

3. **Test and config surface.** 14 separate `scripts/build.sh` mirrors, 4 `*-cjs/package.json` files, 4 entries in `release-please-config.json`, 4 entries in the manifest, `--filter './packages/*-cjs'` repeats in `release.yml`, a `mirror-cjs-versions.mjs` script, a test for the mirror contract. Every point is a small thing; together they add up to "every dependency change requires a coordination step."

**The flip side is small and bounded:**

- `engines.node: ">=22.12"` makes `require(esm)` native and stable. CJS consumers `require('@spanexx/sdk-node')` and get the ESM module directly. No translator layer needed.
- Zero consumers exist. The risk of dropping is "broken-install for someone unknown" — not "broken-install for someone known."

---

## Behavioral Spec

### Scenario 1 (Primary): Operator installs any published package today

**Given** a Node 22.12+ host, the example repo at HEAD clean, and a fresh install
**When** `cd example && pnpm install`
**Then** the install resolves to `@spanexx/sdk-node@0.1.0` and `@spanexx/event-bus@0.1.0` — both ESM. No `-cjs` package name appears in the lockfile. The example's `pnpm run serve` continues to register 11 caps with the gateway.

### Scenario 2: A future consumer on Node < 22.12 attempts install

**Given** a Node 20 host (representing the old floor)
**When** they run `npm install @spanexx/sdk-node@latest`
**Then** npm refuses with `EBADENGINE`/`Unsupported engine` — the `engines.node: ">=22.12"` field gates the install. The error message names the engine and the required range. (This is npm's standard behavior; we don't need a CLI shim.)

### Scenario 3: GitHub Actions CI runs the publish workflow

**Given** a tag push to main
**When** `release.yml`'s publish job runs
**Then** the build step builds 14 ESM packages (no `-cjs` `--filter` entries). The publish step publishes those same 14. No `Mirror CJS variants to ESM versions` step exists. The log is shorter by roughly 8 lines of CJS bookkeeping.

### Scenario 4: A developer pnpm-installs the example

**Given** the example's dependencies just switched from `@spanexx/sdk-node-cjs` to `@spanexx/sdk-node`
**When** they boot the example's `pnpm run serve`
**Then** the example boots, the gateway connection succeeds, and 11 caps register — same behavior as before. The `from '@spanexx/sdk-node-cjs'` import line in `example/src/platform/platform.agent.ts` is now `from '@spanexx/sdk-node'`. Nothing else changes in the example's source.

---

## Design

### What changes

| Thing | Before | After |
|---|---|---|
| `packages/sdk-node-cjs/` | workspace tree, src/, dist/, tests/, scripts/build.sh | deleted |
| `packages/event-bus-cjs/` | workspace tree | deleted |
| `packages/sdk-browser-cjs/` | broken workspace tree (D-75) | deleted |
| `packages/agentide-cjs/` | broken workspace tree (D-76) | deleted |
| `packages/agentide/scripts/mirror-cjs-versions.mjs` | script, called in `release.yml` | deleted |
| `packages/agentide-cjs/src/__tests__/mirror-cjs-versions.test.ts` | 5 tests | deleted |
| `packages/agentide/src/__tests__/cjs-mirror-build.test.ts` | 4 tests | deleted |
| `packages/agentide/src/__tests__/release-yml.test.ts` | 6 tests (some CJS-specific) | rewritten to drop the CJS-specific assertions |
| `.github/workflows/release.yml` build step `--filter` | 14 ESM + 0 CJS (already only ESM post-cjs-sdk-bootstrap Phase 3) | 14 ESM only, no CJS lines |
| `.github/workflows/release.yml` mirror step | runs `mirror-cjs-versions.mjs` | step deleted |
| `.github/release-please-config.json` | 14 packages map | 14 packages map (no change — was already post-CJS) |
| `.github/release-please-manifest.json` | 18 entries (14 ESM + 4 CJS) | 14 entries (no `-cjs`) |
| All 14 ESM `package.json` | `engines.node: ">=20"` | `engines.node: ">=22.12"` |
| `example/package.json` | `@spanexx/sdk-node-cjs` in deps | `@spanexx/sdk-node` in deps |
| `example/src/platform/platform.agent.ts` | `from '@spanexx/sdk-node-cjs'` | `from '@spanexx/sdk-node'` |
| `docs/drift.md` | D-75 / D-76 open | D-75 / D-76 closed |
| `.agents/skills/ci-cd-agentide/SKILL.md` | references CJS siblings + mirror script | updated to "no CJS siblings, single ESM surface" |
| `.agents/skills/release-agentide/SKILL.md` | mentions CJS publish | updated |
| `docs/operations/release-process.md` | reflects 16-package publish | reflects 14-package publish |

### What does NOT change

- `pnpm-lock.yaml` lockfile structure — it regenerates after `pnpm install` in the example repo.
- The example's behavior end-to-end — same `Registered 11 caps` log line.
- The agentide CLI's behavior — `agentide start --port-sdk` still works.
- The precommit gate — `pnpm run precommit` still runs the same checks.

### Phase Plan

#### Phase 1 — Example app import swap (the unblock)

Goal: prove the example works with the ESM package before deleting the CJS one. TDD first.

- Change `example/package.json` `dependencies["@spanexx/sdk-node-cjs"]` → `"@spanexx/sdk-node"` (same semver range).
- Change `example/src/platform/platform.agent.ts` line 2: `from '@spanexx/sdk-node-cjs'` → `from '@spanexx/sdk-node'`.
- `cd example && pnpm install && pnpm run build && pnpm run serve` — verify `Registered 11 caps` still appears in the log.
- Run the existing dev-bootstrap.test.ts in agentide to confirm the SDK door + banner + connection still work — no behavior change expected, this is regression coverage.

#### Phase 2 — Directory + script deletion

- Delete `rm -rf` the four `*-cjs/` source trees.
- Delete `packages/agentide/scripts/mirror-cjs-versions.mjs`.
- Delete `cjs-mirror-build.test.ts` (was 4 tests; tests behavior that no longer exists).
- Run `pnpm test` to confirm no other test referenced the CJS paths.
- Update `release-yml.test.ts` — drop the CJS-specific assertions; the test still pins "mirror runs before install" but the underlying step is gone (rewrite to test that the mirror step IS absent and the publish filter is the 14-package list verbatim).

#### Phase 3 — engines bump

- Loop the 14 ESM packages: set `engines.node` to `">=22.12"`.
- One commit, 14 files. Boring on purpose.
- Verify: `pnpm run precommit` clean, `pnpm test` green.

#### Phase 4 — Publish + manifest cleanup

- Remove the four `*-cjs` entries from `.github/release-please-manifest.json`.
- Remove `Mirror CJS variants to ESM versions` step from `.github/workflows/release.yml`.
- Confirm the `--filter` lists in `release.yml` are now exactly the 14 ESM packages (they already are post-cjs-sdk-bootstrap, but verify and lock).
- Remove `--filter './packages/*-cjs'` patterns if any survived the cjs-sdk-bootstrap pack — they should already be absent; this phase is verification.

#### Phase 5 — Skills + drift + docs

- `.agents/skills/ci-cd-agentide/SKILL.md`: drop CJS Versions rows; mark Discovered bugs #1 + #5 closed (the broken CJS chains no longer exist; the script doesn't exist either); update "16 packages published" → "14 packages published, single ESM surface"; drop `mirror-cjs-versions.mjs` toolkit row.
- `.agents/skills/release-agentide/SKILL.md`: drop the CJS-publish mention.
- `docs/operations/release-process.md`: drop CJS reference.
- `docs/drift.md`: close D-75 (sdk-browser-cjs is gone, not a build problem anymore) and D-76 (agentide-cjs is gone); mention the drop-cjs-siblings pack in the resolution sentence.

---

## API changes

None on the wire. The SDK API surface is unchanged. The CLI surface is unchanged.

---

## Out-of-scope drifts (logged)

- **D-75** — sdk-browser-cjs build chain broken. Closing: the package is deleted in this pack; the build chain no longer exists.
- **D-76** — agentide-cjs build chain broken. Closing: same — the package is deleted.
- **D-77** — mirror-cjs-versions.mjs no-op. Closing: the script is deleted in this pack.

---

## Cross-pack impact

- **release-process** (BI[30]) — post-drop, the "Cut a release" recipe is simpler. The mirror step is gone, the publish filter is 14 instead of 16.
- **cjs-sdk-bootstrap** — superseded; the version bumps that pack shipped become stale at the next publish (sdk-node-cjs and event-bus-cjs won't be re-published).
- **HOWTOAGENTIDE.html** — unchanged (already reflects post-cjs-sdk-bootstrap two-door world).
- **Example app** — works as written; this pack ONLY changes the import line.
