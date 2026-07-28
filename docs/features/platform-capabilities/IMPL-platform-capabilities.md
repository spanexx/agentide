# Implementation Plan: Platform Capabilities

## Status

- Type: Phased implementation plan
- Audience: Backend, QA
- Scope: Vertical-slice implementation of `@platform/platform-capabilities`, the ownership migration of 16 existing caps, the `authz` wildcard fix, the 9 new capability handlers, and the CLI filter additions.
- PRD: [PRD-platform-capabilities.md](./PRD-platform-capabilities.md)
- TRD: [TRD-platform-capabilities.md](./TRD-platform-capabilities.md)
- FLOW: [FLOW-platform-capabilities.md](./FLOW-platform-capabilities.md)

## 1. Planning Principles

1. **Migration is the point.** The PR is mostly about removing 16 wrong-owner records and replacing them with 25 correct-owner records. The hard part is the cross-owner collision check; the 5-phase `register` dance in TRD §4.2 is the only viable path.
2. **The wildcard must be a flag day, not a behavior toggled by a config.** `platform.*.read` either works for everyone or it doesn't. v1 ships it working; the authz change is permanent.
3. **New handlers are in gateway-core, not in the new package.** Per Q1 + Q4 (GRILL): the new package owns registration only; the kernel owns handlers because they touch in-process state (Plugin Manager, audit log, secret). The new package has no source files that ship handlers.
4. **Tests before code per phase.** Each phase ships its own test cases. The full suite must remain green at every phase boundary (current: 242 tests; target: 250+).
5. **CLI filters are pure pre-existing capability data.** `--owner` and `--tier` filter what's already in the registry. No new capability records; no new handlers; just a thin client-side filter in the CLI.

## 2. Current Baseline

- `@platform/gateway-core` is shipped and merged. `registerGatewayCapabilities` in `packages/gateway-core/src/factory.ts:71-91` registers 16 caps under owner=`gateway`.
- `checkAuthz` in `packages/gateway-core/src/authz.ts:53-89` does NOT support `*` in the namespace slot. Only `*` (bare) and exact match work today.
- `plugin.*` and `system.*` cap records do not exist. The CLI reaches Plugin Manager via a direct call (`packages/agentide/src/cli.ts:241`), not via the registry.
- `agentide capability list` does not support `--owner` or `--tier` filters.
- 242 platform tests pass. Precommit clean (0 errors, 0 warnings).

## 3. Phase Plan

---

### Phase 0: Foundation

**Goal**: New package skeleton compiles; workspace knows about it.

**Why this phase first**: We need a stable target for the registration code before adding the logic.

#### Backend tasks

- [ ] Create `packages/platform-capabilities/package.json` with name `@platform/platform-capabilities`, deps: `@platform/capability-registry` (workspace), `typescript` (devDep).
- [ ] Create `packages/platform-capabilities/tsconfig.json` extending `../../tsconfig.base.json`.
- [ ] Create `packages/platform-capabilities/src/index.ts` (empty export `export {}`).
- [ ] Add a workspace reference in root `tsconfig.json` (`packages/platform-capabilities`).
- [ ] Run `pnpm install` to update the lockfile.

#### Validation condition

> `pnpm run build` succeeds. `grep -n "platform-capabilities" tsconfig.json` returns at least one match.

#### Regression check

> `pnpm run test` returns 242 passing. `pnpm run lint` returns 0 errors.

---

### Phase 1: Registration + Migration

**Goal**: All 25 caps registered under correct owners. The 16 legacy records are migrated. `registerGatewayCapabilities` is removed.

**Blocked by**: Phase 0

#### Backend tasks

- [ ] Create `packages/platform-capabilities/src/caps.ts` — exports 25 `CapabilityRecord` values via the `cap(...)` helper.
- [ ] Create `packages/platform-capabilities/src/index.ts` — exports `registerPlatformCapabilities(registry)` that does the 4-call migration (gateway, session-manager, capability-registry, plugin-manager).
- [ ] Update `packages/gateway-core/src/factory.ts`:
  - Remove `registerGatewayCapabilities` (lines 71-91 + the `cap` helper at lines 93-107).
  - Replace `await registerGatewayCapabilities(registry);` (line 156) with `await registerPlatformCapabilities(registry);`.
  - Add import: `import { registerPlatformCapabilities } from "@platform/platform-capabilities";`.
- [ ] Update `packages/gateway-core/src/factory.ts` handlers — rename permission strings:
  - `session.create`, `session.resume`, `session.destroy`, `session.touch`: `["platform.session.create"]` → `["platform.session.write"]` (in handler registration, not handler logic).
  - `auth.token.issue`, `auth.token.revoke`: `["platform.token.issue"]` → `["platform.token.write"]`.
- [ ] Add `@platform/platform-capabilities` to `packages/gateway-core/package.json` dependencies.

#### Tests required

- [ ] `packages/platform-capabilities/src/__tests__/register.test.ts`:
  - Fresh install: 25 caps registered under correct owners.
  - Upgrade case: pre-register 16 caps under `owner="gateway"` (simulating pre-BI[6] state); call `registerPlatformCapabilities`; verify final state has 25 caps under correct owners with no duplicates.
  - Idempotent: call twice; second call is a no-op.
- [ ] `packages/gateway-core/src/__tests__/factory.test.ts` (or new migration test):
  - `createGateway` produces a registry with 25 caps after construction.
  - `registerGatewayCapabilities` is no longer in the source (grep check).
- [ ] `packages/gateway-core/src/__tests__/handle-invocation.test.ts`:
  - Existing tests still pass (the auth permissions may need updating in test signatures; see Phase 3 if authz wildcard fix requires it).

#### Validation condition

> AC-1: `capabilityRegistry.list().length === 25` after `createGateway`.
> AC-1: `registry.describe("session.create").capability.owner === "session-manager"`.
> AC-5: `grep -rn "registerGatewayCapabilities" packages/gateway-core/src/` returns 0 matches.

#### Regression check

> All 242 existing tests still pass. No new tests added yet.

---

### Phase 2: authz Wildcard

**Goal**: `platform.*.read` covers every read-tier platform cap. `platform.*.write` covers every write-tier.

**Blocked by**: Phase 1

#### Backend tasks

- [ ] Update `packages/gateway-core/src/authz.ts` — add namespace-wildcard rule in `tierCovers`:
  ```ts
  if (grantedParts[1] === "*" || requiredParts[1] === "*") {
    return gr >= req;
  }
  ```
  Insert between line 86 (the kind check) and line 87 (the namespace match). Update the `CID:authz-001` comment to document the wildcard.

#### Tests required

- [ ] `packages/gateway-core/src/__tests__/authz.test.ts` (new test cases, append to existing):
  - `checkAuthz(["platform.*.read"], ["platform.session.read"])` → true.
  - `checkAuthz(["platform.*.read"], ["platform.tenant.read"])` → true.
  - `checkAuthz(["platform.*.read"], ["platform.plugin.read"])` → true.
  - `checkAuthz(["platform.*.write"], ["platform.plugin.write"])` → true.
  - `checkAuthz(["platform.*.read"], ["platform.session.write"])` → false (rank insufficient).
  - `checkAuthz(["platform.*.write"], ["platform.session.read"])` → true (write covers read).
  - `checkAuthz(["platform.*.read"], ["runtime.session.read"])` → false (kind mismatch, wildcard doesn't cross kind).
  - `checkAuthz(["platform.*.read"], ["app.session.read"])` → false (business caps exact-match only).
  - Bare `*` still works (regression): `checkAuthz(["*"], ["platform.session.write"])` → true.

#### Validation condition

> AC-4: A token with `scope: ["platform.*.read"]` can invoke `session.list`, `tenant.list`, `capability.list`, `gateway.status`, `plugin.list`, `system.info`, `system.version`, `system.health` (all pass `checkAuthz`).
> AC-4: The same token denied for `session.create`, `plugin.install` (rank insufficient).

#### Regression check

> All 242+ existing tests still pass. New wildcard tests pass.

---

### Phase 3: Plugin.* + System.* Handlers

**Goal**: The 9 new caps are reachable through `gateway.handleInvocation`. `plugin.install` actually installs a plugin; `system.health` returns `{status: "ok"}`.

**Blocked by**: Phase 1

#### Backend tasks

- [ ] Update `packages/gateway-core/src/factory.ts` — add 9 new entries to `buildGatewayHandlers`:
  - `plugin.list` → `pluginManager.list()` (input: `{}`)
  - `plugin.install` → `pluginManager.install(input.source)` (input: `{source: string}`)
  - `plugin.uninstall` → `pluginManager.uninstall(input.id)` (input: `{id: string}`)
  - `plugin.enable` → `pluginManager.enable(input.id)` (input: `{id: string}`)
  - `plugin.disable` → `pluginManager.disable(input.id)` (input: `{id: string}`)
  - `plugin.reload` → `pluginManager.reload(input.id)` (input: `{id: string}`)
  - `system.info` → `{name: "agentide", version: <from package.json>}` (input: `{}`)
  - `system.version` → `{version: <semver>, buildHash: null}` (input: `{}`)
  - `system.health` → `{status: "ok"}` (input: `{}`)
- [ ] Read the version from `packages/gateway-core/package.json` at factory time (cache via top-level `JSON.parse` + `readFileSync` of the package.json — or, simpler, accept a `version` field in `GatewayConfig` and default to `env.AGENTIDE_VERSION ?? "0.0.0"`).
- [ ] Validate input shapes inside each handler (throw `INVALID_REQUEST` on missing fields).

#### Tests required

- [ ] `packages/gateway-core/src/__tests__/plugin-handlers.test.ts` (new):
  - `plugin.list` returns the current `pluginManager.list()`.
  - `plugin.install` with `{source: test.yaml}` calls `pluginManager.install` and returns the `InstallRecord`.
  - `plugin.uninstall` with `{id: "foo"}` calls `pluginManager.uninstall("foo")`.
  - `plugin.enable` / `plugin.disable` / `plugin.reload` — same pattern.
  - `plugin.install` with missing `source` → `INVALID_REQUEST`.
- [ ] `packages/gateway-core/src/__tests__/system-handlers.test.ts` (new):
  - `system.info` returns `{name: "agentide", version: <test-pinned>}`.
  - `system.version` returns `{version: <test-pinned>, buildHash: null}`.
  - `system.health` returns `{status: "ok"}`.
- [ ] `packages/gateway-core/src/__tests__/handle-invocation.test.ts` (extend):
  - Integration: `handleInvocation({capability: {name: "plugin.list"}})` → output is `InstallRecord[]`.
  - Integration: `handleInvocation({capability: {name: "system.health"}})` → output is `{status: "ok"}`.

#### Validation condition

> AC-3: `handleInvocation({capability: {name: "plugin.install"}, input: {source: "./test.yaml"}})` → output is an `InstallRecord`.
> AC-4: `handleInvocation({capability: {name: "system.info"}})` → succeeds with the expected shape.
> AC-4: `handleInvocation({capability: {name: "system.health"}})` → returns `{status: "ok"}`.

#### Regression check

> All 242+ existing tests still pass. ~12 new handler tests pass.

---

### Phase 4: CLI Filters

**Goal**: `agentide capability list --owner session-manager` and `--tier read` work.

**Blocked by**: Phase 1

#### Backend tasks

- [ ] Update `packages/agentide/src/cli.ts` — `runCapability`:
  - Add `getFlag(flags, "owner", "")` and `getFlag(flags, "tier", "")` reads.
  - If `owner` is set: iterate `list()` → for each `name`, call `describe(name)` → filter by `record.owner === owner`.
  - If `tier` is set: iterate `list()` → for each `name`, call `describe(name)` → filter by checking if any of `record.permissions` ends with `.tier` (e.g., `platform.session.read` ends with `.read`).
  - If both set: AND the filters.
  - Output line format: `- <name>\t<version>\t<description>` (unchanged).
- [ ] Add `--owner` and `--tier` to the HELP string.

#### Tests required

- [ ] `packages/agentide/src/__tests__/cli-capability-list.test.ts` (new):
  - `--owner session-manager` → 5 caps.
  - `--owner capability-registry` → 2 caps.
  - `--owner plugin-manager` → 6 caps.
  - `--owner gateway` → 12 caps.
  - `--owner nonexistent` → 0 caps.
  - `--tier read` → all read-tier caps.
  - `--tier write` → all write-tier caps.
  - `--owner plugin-manager --tier read` → 1 cap (`plugin.list`).
  - No filter → 25 caps.

#### Validation condition

> AC-6: `agentide capability list --owner session-manager` lists exactly the 5 session.* caps.

#### Regression check

> All 242+ existing tests still pass. New CLI filter tests pass.

---

### Phase 5: Final Validation

**Goal**: The full test suite is green. Precommit is clean. The package is shippable.

**Blocked by**: All previous phases complete and validated.

#### Tasks

- [ ] Run `pnpm run test` — target 250+ tests, all green.
- [ ] Run `pnpm run lint` — 0 errors, 0 warnings.
- [ ] Run `pnpm run typecheck` — 0 errors.
- [ ] Run `pnpm run build` — 0 errors.
- [ ] `grep -rn "registerGatewayCapabilities" packages/gateway-core/src/` returns 0 matches.
- [ ] `grep -rn "platform.session.create\\|platform.token.issue" packages/gateway-core/src/` returns 0 matches (renamed permissions are gone).
- [ ] Update `docs/Feature_Backlog.md` (`BI[6]` row → `status: "shipped"`, fill `what` / `impl` / `notes`).
- [ ] Update `docs/CONTEXT.md` decisions log if any new decision was made during implementation.
- [ ] Write a handoff doc at `sessions/.last-handoff` describing the ship.

#### Validation condition

> All 250+ tests pass. Lint + typecheck clean. Backlog updated. Handoff written.

#### Regression check

> Existing 242 tests still pass. New 8+ tests added.

---

## 4. Dependency Checklist

This checklist is a hard gate. No phase may begin code implementation until all packages used in that phase have `opensrc` complete.

### `@platform/capability-registry`

- **Version**: workspace `*`
- **Used in**: Phase 1 (registration)
- **TRD section**: §3.1
- **opensrc command run**:
  ```bash
  opensrc path @platform/capability-registry
  ```
- **Source files read**:
  - `packages/capability-registry/src/index.ts:32-90` — confirms `register` diffs against owner's previous state
  - `packages/capability-registry/src/types.ts:30-43` — `CapabilityRecord` shape
- **Call pattern confirmed from source**:
  ```ts
  import { type CapabilityRegistry, type CapabilityRecord } from "@platform/capability-registry";
  await registry.register("session-manager", { owner: "session-manager", capabilities: [...] });
  ```
- **Error cases to handle** (found in source):
  - Cross-owner collision (line 53-57) → throws `Error` with message `Clash on <name>@<version>: already owned by <owner>`. Not a typed error. The new package must register in dependency order to avoid collisions (the 4-call migration in TRD §4.2).
- **opensrc complete**: Yes

### `@platform/plugin-manager`

- **Version**: workspace `*`
- **Used in**: Phase 3 (handler wiring)
- **TRD section**: §3.2
- **opensrc command run**:
  ```bash
  opensrc path @platform/plugin-manager
  ```
- **Source files read**:
  - `packages/plugin-manager/src/types.ts:164-174` — `PluginManager` interface with 9 methods
  - `packages/plugin-manager/src/types.ts:53-61` — `InstallRecord` shape
- **Call pattern confirmed from source**:
  ```ts
  import type { PluginManager } from "@platform/plugin-manager";
  const record = pluginManager.install("./test.yaml"); // returns InstallRecord
  ```
- **Error cases to handle** (found in source):
  - `install` throws `PluginManagerError` on invalid manifest, missing source, permission clash. The handler's `wrap` helper lets the throw propagate; the kernel's `dispatchCapability` wraps it in `GATEWAY_MANAGER_UNAVAILABLE` (per FLOW 6).
- **opensrc complete**: Yes

### Summary table

| Package | Version | Phase | opensrc complete | Key source finding |
|---|---|---|---|---|
| `@platform/capability-registry` | workspace | Phase 1 | Yes | `register` throws on cross-owner collision; diff is per-owner |
| `@platform/plugin-manager` | workspace | Phase 3 | Yes | `install(source)` returns `InstallRecord`; throws `PluginManagerError` on invalid manifest |

**No new third-party dependencies.** All new code uses first-party packages already in the workspace.

## 5. Test Requirements

- **External behavior only.** Tests assert against the public API of `registerPlatformCapabilities`, `gateway.handleInvocation`, and `agentide capability list`. Internal state (registry's internal Map, gateway's internal handler map) is not tested.
- **Prior art**: follow the patterns in `packages/gateway-core/src/__tests__/handle-invocation.test.ts` (vitest, `setup()` factory, `makeToken(clock, ...)` helper) and `packages/plugin-manager/src/__tests__/install.test.ts`.
- **Layers**:
  - **Backend unit**: `registerPlatformCapabilities` standalone (Phase 1).
  - **Backend integration**: full `createGateway` + `handleInvocation` for the 9 new handlers (Phase 3).
  - **CLI integration**: `runCli` with mocked argv (Phase 4). Follow `packages/agentide/src/__tests__/cli-help.test.ts` pattern.
- **Test data strategy**: use the `inMemoryFs` and `FakeClock` objects that already exist in `packages/gateway-core/src/__tests__/`. Mock the Plugin Manager with a small fake (3 methods) for handler tests.

## 6. Rollout Notes

- **No feature flags.** The 25 caps are registered every startup. The authz wildcard is always on.
- **Migration order**: `registerPlatformCapabilities` is the only registration call. The factory removes the old `registerGatewayCapabilities` in the same commit. The migration is atomic from the registry's perspective: after the first call to the new function, the registry's state is consistent with the new owner layout.
- **Backwards compatibility**: callers who minted tokens with `platform.session.create` (the old permission name) will see `INSUFFICIENT_SCOPE` after the upgrade. The migration guide is in the handoff: re-issue tokens with `platform.session.write`.
- **Downgrade**: requires a manual `agentide capability reset` step (out of scope for v1). Documented in the handoff.
- **Environment variables**: Phase 3's `system.version` reads `process.env.AGENTIDE_VERSION` (default `"0.0.0"`). Operators can set this in `install.sh` to inject the build version.
