---
slug: cjs-sdk-bootstrap
status: Draft
date: 2026-08-05
audience: meta/infrastructure
---

# PRD-TRD — cjs-sdk-bootstrap

> Two gaps in the agentide monorepo jointly block the example nest app from
> registering its capabilities with the gateway: the backend-runtime door is
> not opened by either dev bootstrap (`agentide start --all-doors`, which
> retired the old `start-gateway.mjs` script — D-114) or the CLI
> (`agentide start`), and the CJS sibling packages are stuck at the 0.0.1
> version family while the ESM SDKs have moved to 0.1.0. This pack unlocks
> both — the example app `pnpm run gateway` + `pnpm run serve` connect clean
> and register 11 caps without any example-side code change.

> Source of truth for locked decisions:
> `docs/features/cjs-sdk-bootstrap/GRILL-cjs-sdk-bootstrap.txt` (7 Qs, locked
> 2026-08-05). Plan: this file. Operator playbook: `.agents/skills/release-agentide/SKILL.md`.

---

## Why this exists

The example nest app at `../example/` (master, last commit `89fd083 fix:
switch to CJS sibling SDK, fix WS handshake and manifest shape`) is the
canonical end-to-end demo that the agentide monorepo ships for downstream
consumers. It mounts `@spanexx/sdk-node-cjs` + `@spanexx/event-bus-cjs`
into a NestJS app and registers 11 business caps (`product.list`,
`product.get`, `product.create`, `user.register`, `user.get`, `cart.add`,
`cart.remove`, `cart.view`, `order.create`, `order.get`, `order.list`)
with the gateway.

It does not work today. The README's "Known issue" cards the symptom
("WS handshake returns 400"); the actual root cause is two missing seams
in the agentide monorepo:

1. **The SDK's door is not opened by either dev bootstrap.** `pnpm run
   gateway` (`agentide start --all-doors`, formerly `scripts/start-gateway.mjs`
   — retired 2026-08-08, D-114) and `agentide start` (CLI) both
   call `createPlatform({ ... })` WITHOUT `backendRuntimePort`. The
   factory only creates the backend-runtime door when `backendRuntimePort`
   is set (`packages/agentide/src/factory.ts:83`). The SDK's door — the
   one that accepts `{type: "sdk.auth", token}` per CONTEXT.md T5 Q1
   lock — is therefore never bound. The SDK literally has no reachable
   target. The fallback "they'll talk to adapter-websocket 7300" is
   incorrect: adapter-websocket's `parseClientFrame` returns
   `{type: "invalid"})` for `sdk.auth` (only `auth`/`subscribe`/
   `unsubscribe`/`invoke` are accepted; `packages/adapter-websocket/src/
   protocol.ts:47-71`). An SDK attempt on 7300 is silently dropped pre-
   auth, then 30s timeout → close 1008.
2. **The CJS sibling packages are stale.** `@spanexx/sdk-node-cjs` and
   `@spanexx/event-bus-cjs` on npm are 0.0.1, frozen at the snapshot
   taken when the CJS build was first wired (predates the
   sdk-node/src/client.ts re-wire). The latest release-process pack
   publish (the 14 ESM packages, 2026-08-05) explicitly filtered out
   the `-cjs` siblings because the publish helper
   `packages/agentide/scripts/mirror-cjs-versions.mjs` is a no-op (the
   npm publish filter lists only ESM packages). The CJS mirror code
   itself isn't broken on protocol — `packages/sdk-node-cjs/src/client.ts`
   ships `sdk.auth` — but the version is stale, and the example's
   `pnpm install` picks 0.0.1 from npm.

The example's `.env` pastes a `PLATFORM_TOKEN` twice onto one line
(`...r6e_wPLATFORM_TOKEN=...r6e_w`) AND the token is expired (1h TTL,
issued 2026-08-04, today 2026-08-05). Both artifacts are user-side
symptoms of the structural gap; fixing the gap makes the artifacts
irrelevant because the example will mint a fresh token via
`agentide token issue` and the URL will be the right one.

The example's `src/platform/platform.agent.ts` uses the current
`createSdk` shape (`createSdk({gateway, app, manifest, handlers,
observability})` — matches `packages/sdk-node/src/index.ts:50` factory
signature). No example-side code change is needed.

---

## Behavioral Spec

### Scenario 1 (Primary): Operator boots the example dev stack

**Given** the agentide repo is freshly cloned, the example repo is
freshly cloned, the user has run `npm i -g @spanexx/agentide@0.1.1`
and the example CJS packages have been bumped to 0.1.0 on npm
**When** they run, in two terminals:

```
# terminal 1 — from the agentide repo
pnpm run gateway

# terminal 2 — from the example repo
pnpm install
pnpm run build
pnpm run serve
```

**Then** within ~5 seconds, both processes log:
- gateway: `platform up — mcp :7100, ws :7300, sdk :7350` (note: the new
  `sdk :7350` segment is the fix).
- example: `Registered 11 caps` (platform.agent.ts:89).

The gateway log shows `backend-sdk-nestjs-ecommerce` in the `Owner`
column of `agentide capability list --owner backend-sdk`. The
`agentide invoke product.list '{}'` round-trip returns ≥ 0 items in
under 200ms with no `GATEWAY_SDK_UNREACHABLE` error.

### Scenario 2: CLI start with SDK door (operator opt-in)

**Given** an operator wants the SDK door open in a production-shaped
gateway (no dev-bootstrap script — retired 2026-08-08, D-114)
**When** they run `agentide start --port-sdk 7350`
**Then** the platform boots with the SDK door on `127.0.0.1:7350` and
the same scenario 1 outcomes follow. Running `agentide start` (no
flag) continues to boot WITHOUT the SDK door (the backward-compat
regression test at `factory.ts:78-80` stays green).

### Scenario 3: CJS version bump

**Given** the example's `package.json` pins `^0.0.1` for both
CJS packages
**When** we publish `sdk-node-cjs` and `event-bus-cjs` at 0.1.0
**Then** the example's `pnpm install` resolves to 0.1.0 (semver
caret). The CJS SDK continues to send `sdk.auth` (the wire
protocol didn't change — the version bump is the migration
vehicle for the stay-in-sync story).

### Scenario 4: Doc drift surfaces get rewritten

**Given** the example's `BUILDING-WITH-AGENTIDE.md` and `README.md`
both say `ws://127.0.0.1:7300/ws` (wrong door + wrong path)
**When** this pack ships
**Then** those docs (and `packages/sdk-node/README.md`) point at the
backend-runtime door: `ws://127.0.0.1:7350` (no path). The adapter-
websocket 7300 door is documented as the "agent/CLI/dashboard" door
and the backend-runtime door as the "backend SDK" door per the
CONTEXT.md adapter-vs-runtime distinction.

---

## Design

### What changes

| Thing | Before | After |
|---|---|---|
| `agentide start --all-doors` (retired `start-gateway.mjs`) | script opened `{adapterMcp, adapterWs}` only | `--all-doors` opens all four doors incl. `backendRuntimePort: 7350` + `adapterRestPort: 7400` |
| `agentide start` CLI | no SDK flag | `--port-sdk <n>` (default 7350 when present); opt-in; flag absent → no SDK door |
| `packages/sdk-node-cjs/package.json` | version 0.0.1 | version 0.1.0 (semver-aligned with ESM family) |
| `packages/event-bus-cjs/package.json` | version 0.0.1 | version 0.1.0 |
| `packages/agentide/src/factory.ts` | no `DEFAULT_SDK_PORT` constant | new `DEFAULT_SDK_PORT = 7350` (sibling to `DEFAULT_ADAPTER_MCP_PORT`/`DEFAULT_ADAPTER_WS_PORT`) |
| `packages/agentide/src/start.ts` | no `--port-sdk` parsing | parses + validates the flag, passes `backendRuntimePort` to `createPlatform` |
| `packages/agentide/src/cli.ts` | no SDK help text | help text mentions `--port-sdk` |
| `packages/agentide/scripts/mirror-cjs-versions.mjs` | no-op for publish | bumps versions + mirrors so the CJS publish step is one command |
| `.github/workflows/release.yml` | publish filter lists 14 ESM packages | adds `--filter './packages/sdk-node-cjs' --filter './packages/event-bus-cjs'` to both the build and the publish steps |
| `.github/release-please-manifest.json` | `sdk-node-cjs: 0.0.1`, `event-bus-cjs: 0.0.1` | `sdk-node-cjs: 0.1.0`, `event-bus-cjs: 0.1.0` |
| `example/.env` | glued double `PLATFORM_TOKEN`, expired | fresh token minted via `agentide token issue --tenant acme --caller nest-app --scope '*'`; `PLATFORM_GATEWAY_URL=ws://127.0.0.1:7350` |
| `example/package.json` | `pnpm-workspace.yaml: minimumReleaseAgeExclude: [...] sdk-node-cjs@0.0.1, event-bus-cjs@0.0.1` | remove the CJS entries (after the new versions age out) |
| Docs | `BUILDING-WITH-AGENTIDE.md` §5 + `example/README.md` + `packages/sdk-node/README.md` | rewrite URL to `ws://127.0.0.1:7350` (no path) + add a "Quick start" section to the example README |

### What does NOT change

- The SDK wire protocol (`sdk.auth` first message). The CJS mirror
  already ships it correctly.
- `factory.ts`'s backward-compat regression test (no backendRuntime →
  `GATEWAY_SDK_UNREACHABLE` from dispatch). The CLI flag is opt-in,
  default absent.
- `sdk-browser-cjs` and `agentide-cjs`. Their `scripts/build.sh`
  mirrors succeed but the resulting `dist` cannot resolve all
  transitive deps (sdk-browser-cjs imports `@spanexx/backend-runtime`
  which has no CJS sibling; agentide-cjs pulls in 6 ESM-only packages).
  Logging both as drift D-75 / D-76 and leaving them un-shipped is
  the explicit scope-out from this pack.
- `agentide.js` bootstrap CLI (the in-process operator CLI). It is the
  SAME CLI that operators use to invoke caps; the example gates the
  SDK side, not the CLI side.
- The architecture (1 adapter-websocket door on 7300 for agents/dashboard;
  1 backend-runtime door on 7350 for SDKs). The CONTEXT.md adapter-vs-
  runtime distinction is the canonical model — this pack brings the
  default boot into alignment with that model.

### Phase Plan

#### Phase 1 — backend-runtime door is reachable (the unlock)

- `packages/agentide/src/factory.ts`: add `export const DEFAULT_SDK_PORT = 7350`
  sibling to `DEFAULT_ADAPTER_MCP_PORT` (line 17) and `DEFAULT_ADAPTER_WS_PORT`
  (line 18). Doc the rationale inline (matches Q2 in the GRILL).
- `packages/agentide/src/start.ts`: parse `--port-sdk` flag alongside
  `--port-mcp` (line 45). Validate against collisions with 7100, 7200,
  7300. Pass `backendRuntimePort` to `createPlatform({ ..., backendRuntimePort: portSdk })`
  only when the flag is present.
- `packages/agentide/src/cli.ts`: extend the help text with the new
  flag and its default.
- `scripts/start-gateway.mjs`: RETIRED 2026-08-08 (D-114) — replaced by
  `agentide start --all-doors` (SDK 7350 + REST 7400 + MCP/WS defaults).
- Mirror CJS edits: `packages/agentide-cjs/src/factory.ts`,
  `packages/agentide-cjs/src/start.ts`, `packages/agentide-cjs/src/cli.ts`
  (the CJS mirror is regenerated by `scripts/build.sh`; verify parity).
- Tests: add one test in `packages/agentide/src/__tests__/start.test.ts`
  that asserts `agentide start --port-sdk 7350` results in platform
  with `backendRuntimePort: 7350` and the SDK door is bound after
  start. The existing regression test (no backendRuntime → SDK
  unreachable) stays untouched.
- Verify: `pnpm run precommit`; restart the dev gateway and confirm
  `ss -tln | grep -E ':(7100|7300|7350)'` shows all three ports.

#### Phase 2 — CJS siblings resync + version bump

- `packages/sdk-node-cjs/scripts/build.sh` — re-run from the package
  dir. The mirror copies the current ESM source (which already sends
  `sdk.auth` correctly per `packages/sdk-node/src/client.ts:123`) and
  rewrites `@spanexx/event-bus` → `@spanexx/event-bus-cjs`. The
  resulting `dist/` matches the ESM build's wire behavior.
- `packages/event-bus-cjs/scripts/build.sh` — re-run. Mirror copies
  current ESM event-bus source.
- `packages/sdk-node-cjs/package.json` — bump `version: 0.0.1` →
  `0.1.0`. Update `description` to reflect the alignment with the
  0.1.0 family.
- `packages/event-bus-cjs/package.json` — bump `version: 0.0.1` →
  `0.1.0`. Update deps to keep the `@spanexx/event-bus` require path
  stable (this is the CJS package's own peer — pnpm install will
  resolve to the CJS version itself once both exist).
- `packages/agentide/scripts/mirror-cjs-versions.mjs` — update from
  no-op to bump versions in `-cjs/package.json` files to match their
  ESM counterparts. Audit log entry: `chore: installable script (was
  no-op)`.

#### Phase 3 — publish the CJS siblings

- `.github/release-please-manifest.json` — align with phase 2 bumps
  (`sdk-node-cjs: "0.1.0"`, `event-bus-cjs: "0.1.0"`).
- `.github/workflows/release.yml` — add `--filter './packages/sdk-node-cjs'`
  and `--filter './packages/event-bus-cjs'` to BOTH the build step
  and the publish step. Reorder so the build runs BEFORE the mirror
  (currently the build is "Build all ESM packages"; rename to "Build
  all publishable packages" and add the two CJS filters).
- Verify locally: `pnpm -r --filter ./packages/sdk-node-cjs --filter
  ./packages/event-bus-cjs build && pnpm -r --filter ./packages/sdk-node-cjs
  --filter ./packages/event-bus-cjs publish --access public --dry-run`.
- Push to a release branch and let release-please open the PR. Merge
  with the bypass actor; the publish workflow runs on the tag.

#### Phase 4 — fix the example app surface

- `example/.env` — replace the broken `PLATFORM_TOKEN` line with a
  fresh token minted via `agentide token issue --tenant acme --caller
  nest-app --scope '*'`. Update `PLATFORM_GATEWAY_URL` to
  `ws://127.0.0.1:7350`.
- `example/package.json` `pnpm-workspace.yaml` `minimumReleaseAgeExclude`
  — remove the two CJS entries (the new versions are 0.1.0, no longer
  fresh-out-of-publish).
- `example/README.md` — replace the "Known issue" section with a
  "Quick start" section that documents the three commands (gateway,
  build, serve) and the success signal (`Registered 11 caps`). Drop
  the "Last package available" paranoia; the publish is real.
- `example/BUILDING-WITH-AGENTIDE.md` §1 + §5 — rewrite the URL to
  `ws://127.0.0.1:7350` (no path); §3 rewrite the SDK import to
  `@spanexx/sdk-node-cjs` (already correct). Add a "Two doors" callout
  that distinguishes the SDK door (backend-runtime on 7350) from the
  agent door (adapter-websocket on 7300).

#### Phase 5 — drift fix + verify

- `docs/drift.md` — open D-75 (sdk-browser-cjs broken build chain —
  imports `@spanexx/backend-runtime` with no CJS sibling) and D-76
  (agentide-cjs broken build chain — pulls 6 ESM-only packages).
  Scope-out reference: this pack only ships sdk-node-cjs + event-bus-cjs.
  D-77 is the closed-out CJS SDK publish resync (was the open bug
  carried over from the release-process pack).
- Verify the example end-to-end:
  - `pnpm run gateway` (in agentide) — banner shows `sdk :7350`.
  - `pnpm run serve` (in example) — logs `Registered 11 caps`.
  - `agentide invoke product.list {}` (with the fresh token) — returns
    the expected empty array.
  - `pnpm run precommit` — clean across both repos.
- Update the operator skill: `.agents/skills/ci-cd-agentide/SKILL.md`
  — add the CJS publish step to the "Cut a release" recipe; bump the
  published-versions table to include the two CJS packages.

---

## API changes (none)

No new public types. No new wire messages. No new event names. The
pack is a configuration + documentation + packaging change.

---

## Open drifts (logged, not fixed in this pack)

- **D-75** — `sdk-browser-cjs` mirrors ESM source but imports
  `@spanexx/backend-runtime`, which has no CJS sibling. Production
  fix = either add a `backend-runtime-cjs` package with its own
  transitive CJS chain (capability-registry-cjs, event-bus-cjs,
  application-cjs, errors-cjs, origin-cjs — a multi-week pack) OR
  bundle the SDK to a single self-contained `dist/sdk-browser.cjs`
  (esbuild) with no transitive runtime deps. The example app does
  NOT need sdk-browser-cjs; this drift is acknowledged and unblocked-
  by-design.
- **D-76** — `agentide-cjs` mirrors ESM source but imports 6 ESM-only
  packages (gateway-core, adapter-websocket, adapter-mcp, backend-
  runtime, capability-registry, event-bus). Same fix shape as D-75.
- **D-77** (Closed) — CJS SDK publish was blocked by the open bug
  carried over from the release-process pack. This pack resyncs the
  mirror and republishes the two CJS siblings that the example
  consumes. Republish leaves the other two CJS siblings at their
  pinned versions until D-75 / D-76 ship.

---

## Cross-pack impact

- `.agents/skills/ci-cd-agentide/SKILL.md` — operator playbook gains
  the "CJS publish enabled" trap note (the publish filter now
  includes two CJS packages; the version bump is auto-handled by
  release-please).
- `.agents/skills/release-agentide/SKILL.md` — the milestone-trigger
  skill does not change; the guidance "first release → publish the
  two CJS siblings" is one-line.
- `docs/operations/release-process.md` — add the CJS publish filter
  to the "publish" recipe (mirrors the section above).
- `docs/HOWTOAGENTIDE.html` — the §2 "WebSocket Door" example should
  point at `ws://127.0.0.1:7350` for SDK and `ws://127.0.0.1:7300/ws`
  for agents. The current HOWTO is silent on the distinction.
