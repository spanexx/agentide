---
slug: drop-cjs-siblings
status: Draft
date: 2026-08-05
phases: 5
estimated_effort: small
---

# IMPL — drop-cjs-siblings

> Companion to `PRD-TRD-drop-cjs-siblings.md`. Locked decisions:
> `GRILL-drop-cjs-siblings.txt` (7 Qs, 2026-08-05).

---

## Phase 1 — Example app import swap (the unblock)

### 🔴 Red: write a test that pins the example source against the ESM package

The example's `platform.agent.ts` currently does
`from '@spanexx/sdk-node-cjs'`. After Phase 1, it should do
`from '@spanexx/sdk-node'`. TDD: a TYPESCRIPT compile-time check via
`tsc --noEmit` in the example repo would catch any remaining imports.

A simpler TDD check: parse `example/src/platform/platform.agent.ts`
and assert it does NOT contain the literal string `-cjs`. This runs
in the agentide test suite (cross-repo) so the example source can't
silently drift back.

`packages/agentide/src/__tests__/example-imports.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const EXAMPLE_PLATFORM_AGENT = path.resolve(
  HERE,
  "../../../../../example/src/platform/platform.agent.ts",
);

describe("example app imports", () => {
  it("CID:drop-cjs-001 — platform.agent.ts imports ESM SDK, not CJS sibling", () => {
    const src = fs.readFileSync(EXAMPLE_PLATFORM_AGENT, "utf-8");
    expect(src).not.toMatch(/-cjs['"]/);    // no -cjs in import lines
    expect(src).toMatch(/@spanexx\/sdk-node/);
  });
});
```

This test will fail today (the file still imports `@spanexx/sdk-node-cjs`).

### 🟢 Green: swap the import + verify

`example/package.json`:

```diff
-    "@spanexx/event-bus-cjs": "^0.0.1",
-    "@spanexx/sdk-node-cjs": "^0.0.1"
+    "@spanexx/event-bus": "^0.1.0",
+    "@spanexx/sdk-node": "^0.1.0"
```

`example/src/platform/platform.agent.ts` line 2:

```diff
-import { createSdk, SdkInstance, Logger as SdkLogger } from '@spanexx/sdk-node-cjs';
+import { createSdk, SdkInstance, Logger as SdkLogger } from '@spanexx/sdk-node';
```

Verify:

```bash
cd /home/spanexx/Shared/Learn/Agent-Bridge-SDK/example
pnpm install
pnpm run build
# start the dev bootstrap (cd ../agentide && pnpm run gateway) in another terminal
pnpm run serve &
EX_PID=$!
sleep 6
grep "Registered 11 caps" /tmp/example.log || echo "FAIL"
kill $EX_PID
```

### Verify

```bash
pnpm vitest run packages/agentide/src/__tests__/example-imports.test.ts
# expected: green (CID:drop-cjs-001)
cd /home/spanexx/Shared/Learn/Agent-Bridge-SDK/example
pnpm install && pnpm run build
# expected: typecheck clean (the src-import line is now valid ESM)
```

---

## Phase 2 — Directory + script deletion

### 🔴 Red: lockfile + workspace invariants

`packages/agentide/src/__tests__/no-cjs-residue.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, "../../../../../..");

const CJS_DIRS = ["sdk-node-cjs", "event-bus-cjs", "sdk-browser-cjs", "agentide-cjs"];

describe("no CJS residue (drop-cjs-siblings)", () => {
  it("CID:drop-cjs-002 — no -cjs workspace trees exist", () => {
    for (const dir of CJS_DIRS) {
      const p = path.join(REPO_ROOT, "packages", dir);
      expect(fs.existsSync(p), `expected ${dir} to be deleted`).toBe(false);
    }
  });

  it("CID:drop-cjs-003 — mirror-cjs-versions.mjs is gone", () => {
    const p = path.join(REPO_ROOT, "packages/agentide/scripts/mirror-cjs-versions.mjs");
    expect(fs.existsSync(p)).toBe(false);
  });

  it("CID:drop-cjs-004 — release.yml has no --filter './packages/*-cjs'", () => {
    const p = path.join(REPO_ROOT, ".github/workflows/release.yml");
    const txt = fs.readFileSync(p, "utf-8");
    expect(txt).not.toMatch(/--filter '\.\/packages\/[a-z-]+-cjs'/);
  });

  it("CID:drop-cjs-005 — release-please-manifest.json has no *-cjs entries", () => {
    const p = path.join(REPO_ROOT, ".github/release-please-manifest.json");
    const txt = fs.readFileSync(p, "utf-8");
    expect(txt).not.toMatch(/"packages\/(sdk-node-cjs|event-bus-cjs|sdk-browser-cjs|agentide-cjs)":/);
  });
});
```

This test will fail today; passing it = the drop is complete.

### 🟢 Green: delete

```bash
cd /home/spanexx/Shared/Learn/Agent-Bridge-SDK/agentide
rm -rf packages/sdk-node-cjs packages/event-bus-cjs packages/sdk-browser-cjs packages/agentide-cjs
rm packages/agentide/scripts/mirror-cjs-versions.mjs
rm packages/agentide/src/__tests__/cjs-mirror-build.test.ts
rm packages/agentide/src/__tests__/mirror-cjs-versions.test.ts
```

Edit `packages/agentide/src/__tests__/release-yml.test.ts`:
- Drop CID:cjs-release-yml-002 / 003 / 004 assertions (they referenced the now-deleted CJS filters).
- Keep CID:cjs-release-yml-001 (mirror-before-install) and rewrite to test that the mirror step IS absent (the publish job is a clean 4-step flow: setup → pnpm install → build → publish, no mirror step).
- Keep the build/publish filter parity test, but the filter list now ends with `agentide` (no `sdk-node-cjs` / `event-bus-cjs`).

Edit `.github/release-please-manifest.json` — drop the four `*-cjs`
entries, normalize JSON whitespace.

Edit `.github/workflows/release.yml` — drop the `Mirror CJS variants to ESM versions` step.

### Verify

```bash
cd /home/spanexx/Shared/Learn/Agent-Bridge-SDK/agentide
pnpm install --frozen-lockfile 2>&1 || pnpm install  # lockfile regenerates
pnpm run precommit
pnpm vitest run packages/agentide/
# expected: all 4 no-cjs-residue tests + remaining agentide tests green
```

---

## Phase 3 — engines bump

### 🔴 Red: pin the engines field shape

`packages/agentide/src/__tests__/engines-bump.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, "../../../../../..");

const PUBLISHED_ESM_PACKAGES = [
  "adapter-mcp", "adapter-websocket", "agentide", "backend-runtime",
  "capability-registry", "errors", "event-bus", "gateway-core",
  "origin", "platform-capabilities", "plugin-manager",
  "sdk-browser", "sdk-node", "session-manager",
];

describe("engines bump (drop-cjs-siblings)", () => {
  it.each(PUBLISHED_ESM_PACKAGES)("CID:drop-cjs-engines-%s — %s requires Node >= 22.12", (pkg) => {
    const p = path.join(REPO_ROOT, "packages", pkg, "package.json");
    const j = JSON.parse(fs.readFileSync(p, "utf-8"));
    expect(j.engines?.node).toBe(">=22.12");
  });

  it("CID:drop-cjs-engines-no-cjs — no -cjs package declares engines", () => {
    // The deleted packages can leak a stale engines declaration
    // through stale lockfile entries; this test fails if it ever
    // returns (means a -cjs tree was resurrected without engines).
    for (const dir of fs.readdirSync(path.join(REPO_ROOT, "packages"))) {
      if (dir.endsWith("-cjs")) {
        const p = path.join(REPO_ROOT, "packages", dir, "package.json");
        if (fs.existsSync(p)) {
          const j = JSON.parse(fs.readFileSync(p, "utf-8"));
          expect(j.engines?.node).toBeUndefined();
        }
      }
    }
  });
});
```

This test will fail for every ESM package (currently `">=20"`).

### 🟢 Green: bump

A small one-shot script in `packages/agentide/scripts/bump-engines.mjs` (or inline):

```bash
cd /home/spanexx/Shared/Learn/Agent-Bridge-SDK/agentide
for pkg in adapter-mcp adapter-websocket agentide backend-runtime \
          capability-registry errors event-bus gateway-core \
          origin platform-capabilities plugin-manager \
          sdk-browser sdk-node session-manager; do
  node -e "
    const fs = require('fs');
    const p = 'packages/${pkg}/package.json';
    const j = JSON.parse(fs.readFileSync(p, 'utf8'));
    j.engines = j.engines ?? {};
    j.engines.node = '>=22.12';
    fs.writeFileSync(p, JSON.stringify(j, null, 2) + '\n');
  "
done
```

(Loops are intentionally trivial; they only edit the engines field.)

### Verify

```bash
pnpm vitest run packages/agentide/src/__tests__/engines-bump.test.ts
# expected: 14 engines tests + 1 no-cjs test, all green
pnpm run precommit
```

---

## Phase 4 — Release manifest cleanup

(Already partly done by Phase 2's no-cjs-residue test. The remaining step is ensuring the manifest only contains ESM packages.)

### 🔴 Red

The no-cjs-residue test already covers the manifest cleanup (CID:drop-cjs-005). If Phase 2's test passes, Phase 4's red phase is met.

### 🟢 Green

If the manifest still has `"-cjs"` entries (it shouldn't after Phase 2, but verify), remove them. Same for `release.yml`'s mirror step.

```bash
# Verify manifest is clean
node -e "
  const j = require('./.github/release-please-manifest.json');
  const cjsKeys = Object.keys(j).filter(k => k.endsWith('-cjs'));
  if (cjsKeys.length) { console.error('still has -cjs:', cjsKeys); process.exit(1); }
"
# expected: silent (no output)

# Verify release.yml has no `Mirror CJS` step
grep -c "Mirror CJS" .github/workflows/release.yml
# expected: 0
```

---

## Phase 5 — Skills + drift + handoff

### Drift log

Append to `docs/drift.md` after the existing D-77 entry:

```markdown
- **D-75** (Closed, 2026-08-05, drop-cjs-siblings) — `sdk-browser-cjs` build chain was broken (transitive `@spanexx/backend-runtime` had no CJS sibling). Closed when the drop-cjs-siblings pack deleted the `sdk-browser-cjs` tree; the build chain no longer exists. Fix the CJS chain was deferred indefinitely — see BI entry for context on why.
- **D-76** (Closed, 2026-08-05, drop-cjs-siblings) — `agentide-cjs` build chain was broken (6 ESM-only deps without CJS siblings). Closed when the drop-cjs-siblings pack deleted the `agentide-cjs` tree.
- **D-77** (Closed 2026-08-05, cjs-sdk-bootstrap) — already closed in the cjs-sdk-bootstrap pack; the script it referenced (`mirror-cjs-versions.mjs`) was deleted by drop-cjs-siblings. No further action.
```

Then update the Open counter:

```diff
- **Open:** 14  **Resolved:** 47  **Critical/High:** 2
+ **Open:** 13  **Resolved:** 49  **Critical/High:** 2
```

### Skills

`agentide-cjs` mention sweep across:
- `.agents/skills/ci-cd-agentide/SKILL.md`
- `.agents/skills/release-agentide/SKILL.md`

For ci-cd-agentide (the bigger one):
- Drop CJS rows from the Versions table.
- Mark Discovered bugs #1 (D-75, D-76) and #5 (mirror-cjs-versions) as Resolved.
- Update "16 packages published" → "14 packages published".
- Drop the `mirror-cjs-versions.mjs` toolkit row.
- Drop the "CJS variant broken build chains" out-of-scope note.

### Docs

`docs/operations/release-process.md`:
- Search for "cjs" / "CJS" / "mirror-cjs" — replace any mention with the post-drop reality.
- Update publish-count if mentioned.

### Handoff

Write `sessions/.last-handoff` with the standard structure:
- Date / branch / what's shipped.
- Test totals (existing tests minus the dropped ones, plus the new no-cjs-residue + engines-bump).
- Next move (publish the post-drop versions to npm so anyone consuming sees the engines bump).

---

## Verify checklist (run end-to-end before marking each phase DONE)

- [ ] Phase 1: example imports ESM; full `pnpm run serve` still registers 11 caps; `example-imports.test.ts` green.
- [ ] Phase 2: all four `*-cjs/` trees deleted; `mirror-cjs-versions.mjs` deleted; `no-cjs-residue.test.ts` green.
- [ ] Phase 3: 14 ESM packages have `engines.node: ">=22.12"`; `engines-bump.test.ts` green; precommit clean.
- [ ] Phase 4: manifest has no `*-cjs` entries; `release.yml` has no `Mirror CJS` step; all tests green.
- [ ] Phase 5: drift log closes D-75 + D-76; skills updated; example end-to-end works from a fresh clone.
- [ ] All phases: `pnpm run precommit` green; `pnpm vitest run packages/agentide/` shows the expected test count.

---

## Explicit non-goals (do NOT do these in this pack)

- Deprecate CJS packages on npm (zero consumers, removal is enough).
- Bump any package's version (release-please handles that on the next tag).
- Add a CLI verify step on Node version (npm/pnpm engines check already).
- Migrate the example to ESM tsconfig (out of scope — the CJS-to-ESM switch is just `require(esm)` working today).
- Restore the cjs-mirror-build or mirror-cjs-versions scripts in a deprecated form (deleted entirely; no resurrection).
- Touch `agentide/docs/HOWTOAGENTIDE.html` (already post-cjs-sdk-bootstrap; nothing new to say until the next phase).
