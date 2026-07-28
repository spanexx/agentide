# TRD: Platform Capabilities

## Status

- Type: Technical requirements document
- Audience: Backend, QA
- Scope: New package `@platform/platform-capabilities` that owns the registration of all 25 platform capabilities (16 migrated from gateway-core under their real owners + 9 new `plugin.*`/`system.*`). Standardizes permission names to `platform.<domain>.{read,write}` and exposes the `platform.*.read` wildcard via an authz seam change. Adds `--owner` / `--tier` filters to the `agentide capability list` CLI.
- PRD: [PRD-platform-capabilities.md](./PRD-platform-capabilities.md)
- GRILL: [GRILL-platform-capabilities.txt](./GRILL-platform-capabilities.txt)

## 1. Current Baseline

### 1.1 Data model

Relevant existing types:

- **Capability Registry types** (`packages/capability-registry/src/types.ts:30-106`): `CapabilityType = "business" | "platform" | "runtime"`, `CapabilityRecord { name, version, type, description, inputSchema?, outputSchema?, permissions: readonly string[], owner }`, `CapabilityRegistry.register(owner, manifest)` returns `Promise<RegisterResult>` (cross-owner collision throws).
- **Plugin Manager types** (`packages/plugin-manager/src/types.ts:41-174`): `InstallRecord { id, type, version, source, installedAt, enabled, lastError? }`, `PluginManager` interface (9 methods: `install`, `installFromRegistry`, `update`, `reload`, `disable`, `enable`, `uninstall`, `list`, `get`).
- **Gateway types** (`packages/gateway-core/src/types.ts`): `CapabilityRecord.owner` is the owner string the factory-level `buildGatewayHandlers` keys against. `DispatchHandlers.gatewayHandlers` map is the single function table the dispatcher consults.

No `platform-capabilities` package exists. No `plugin.*` capability records exist. No `system.*` capability records exist. The `authz.ts` tier-hierarchy does not handle a `*` wildcard in any segment.

### 1.2 API surface

Current public API surfaces relevant to this pack:

- `@platform/capability-registry`: `createCapabilityRegistry(eventBus)` → `register(owner, manifest)`, `list()`, `search()`, `describe(name, version?)`.
- `@platform/plugin-manager`: `createPluginManager(eventBus, registry, config?)` → `PluginManager` (9 methods).
- `@platform/gateway-core`: `createGateway(...)` → `Gateway.handleInvocation(req)`. Includes `registerGatewayCapabilities(registry)` (file: `packages/gateway-core/src/factory.ts:71-91`) which registers 16 platform-level capabilities under owner `"gateway"` with permission names like `platform.session.create`, `platform.token.issue`, etc.
- `@platform/agentide`: `agentide capability {list|describe --name <name>}` CLI in `packages/agentide/src/cli.ts:200-231`. No `--owner` or `--tier` filter flags.

`gateway-core` itself does not currently register any `plugin.*` or `system.*` capability records. The `pluginManager` is wired into the factory, but it has no `pluginManager.list()` capability record. The CLI calls `pluginManager.list()` directly (line 241 of `cli.ts`), bypassing the registry.

### 1.3 Frontend surface

None. (No browser-side work in v1.)

### 1.4 What is missing

1. **Plugin capabilities unreachable through adapters.** `plugin.install`, `plugin.uninstall`, `plugin.enable`, `plugin.disable`, `plugin.reload`, `plugin.list` have no `CapabilityRecord` entries. An MCP/CLI agent calling `tools/call plugin.install` is rejected with `GATEWAY_CAPABILITY_NOT_FOUND` even though the Plugin Manager has handlers.
2. **System capabilities unreachable.** `system.info`, `system.version`, `system.health` have no records.
3. **Owner string is meaningless for platform caps.** All 16 platform caps in `registerGatewayCapabilities` are registered with `owner: "gateway"`. An operator cannot filter caps by team/module.
4. **Permission naming inconsistent.** `platform.session.create` (an action) coexists with `platform.session.read` (a tier). Operators cannot mint a single read-only scope to cover every read-tier cap.
5. **Authz does not support glob wildcards.** `checkAuthz` (`packages/gateway-core/src/authz.ts:53-72`) treats `*` as a literal segment. A scope of `platform.*.read` does not cover `platform.session.read` because `parts[1] === "*"` is compared for equality with `parts[1] === "session"`. The bare `*` scope works (covers everything, line 57) but the wildcarded form `platform.*.read` does not.
6. **CLI cannot filter by owner or tier.** `agentide capability list` returns the full catalog. No way to ask for "session caps only" or "read caps only."

## 2. Target Architecture

### 2.1 Architecture overview

```
┌──────────────────────────────────────────────────────────────┐
│            @platform/platform-capabilities  (NEW)            │
│  - registerPlatformCapabilities(registry)                    │
│  - Single source of truth for all 25 platform-cap            │
│    registration (16 migrated + 9 new)                        │
│  - Permission renames applied on the way through              │
└──────────────────────────────────────────────────────────────┘
                              │
                              │ used by
                              ▼
┌──────────────────────────────────────────────────────────────┐
│              @platform/gateway-core  (kernel)                │
│  - createGateway() calls registerPlatformCapabilities        │
│  - registerGatewayCapabilities() REMOVED                     │
│  - buildGatewayHandlers() adds 9 new handlers:              │
│      plugin.{install,uninstall,enable,disable,reload,list}    │
│      system.{info,version,health}                            │
│  - checkAuthz() upgraded to support "platform.*.read" wildcard│
│  - Permission string renames in the 16 existing handlers      │
└──────────────────────────────────────────────────────────────┘
            │                       │                       │
            ▼                       ▼                       ▼
   ┌──────────────┐        ┌──────────────┐        ┌─────────────────┐
   │  Plugin Mgr  │        │ Capability   │        │  Tier 1 mgrs    │
   │  (handlers)  │        │ Registry     │        │  (route owners) │
   └──────────────┘        └──────────────┘        └─────────────────┘
```

`@platform/platform-capabilities` is a registration seam. It owns the *shape* of every platform cap (name, version, permissions, description, owner) but does not own the handler implementations. Handlers stay where the state lives — `plugin.*` handlers in `gateway-core`'s `buildGatewayHandlers` call `pluginManager` in-process; `system.*` handlers call into the gateway's own state.

### 2.2 New or changed data models

#### New package: `@platform/platform-capabilities`

```
packages/platform-capabilities/
  package.json           # name: "@platform/platform-capabilities", deps: @platform/capability-registry
  tsconfig.json          # extends root, extends ../../tsconfig.base.json
  src/
    index.ts              # registerPlatformCapabilities(registry): Promise<void>
    caps.ts               # 25 CapabilityRecord[]  (the canonical list)
# No HANDLER code — handlers live in gateway-core. This package is a registration seam only.
```

The 25 records are constructed from a single `cap(...)` helper that mirrors the gateway-core factory's old helper:

```ts
interface CapInput {
  name: string;
  owner: string;                 // "session-manager" | "capability-registry" | "gateway" | "plugin-manager"
  permissions: readonly string[]; // "platform.<domain>.<read|write>"
  tier: "read" | "write";        // recorded as description suffix only — tier IS implied by permission naming
  description: string;
}

function cap(name: string, owner: string, permissions: readonly string[], description: string): CapabilityRecord {
  return { name, version: "1.0.0", type: "platform", permissions, owner, description };
}
```

#### New `authz.ts` segment-wildcard support

The current `tierCovers` (`packages/gateway-core/src/authz.ts:74-89`) does exact-match on `parts[1]`. Add one rule:

```ts
// Existing rule: grantedParts[1] === requiredParts[1]  (strict namespace match)
// New rule:      grantedParts[1] === "*"               (wildcard namespace match)
// New rule:      requiredParts[1] === "*"              (degenerate — never the case for a concrete cap)
```

A leading-segment wildcard (`*.foo.bar`) is not supported. The wildcard `*` is only meaningful as the namespace slot for `platform.*.<tier>` and `runtime.*.<tier>`.

The bare `*` scope (covers everything) continues to work via the existing `if (granted === "*") return true;` early return at line 57.

#### New CLI filter flags

`agentide capability list` gains two optional flags:

| Flag | Type | Effect |
|---|---|---|
| `--owner <string>` | string | Only list caps whose `owner` exactly matches |
| `--tier <string>` | "read" \| "write" | Only list caps whose `permissions` include `platform.<x>.<tier>` for some `<x>` (tier inferred from the permission name's last segment) |

Both flags are pure client-side filters on the registry's `list()` output. No new capability handler needed.

### 2.3 API contracts

#### `registerPlatformCapabilities(registry)`

```ts
async function registerPlatformCapabilities(registry: CapabilityRegistry): Promise<void>;
```

**Behavior**: idempotent. Calls `registry.register(...)` once with the 25-cap manifest. The registry's existing `register` diffs against the owner's previous state — re-registering on a restart is a no-op (no added/updated/removed entries).

**Cross-owner collision**: the registry's `register` rejects with `Error` if a cap with the same `(name, version)` is already owned by a different owner. Migration is safe because the new package uses the same `version: "1.0.0"` for all 25 caps; the chmod risk is when one of the 16 migrated caps collides with an existing record under the wrong owner. The factory's call order (existing `registerGatewayCapabilities` runs first or removed) is the migration concern.

**Replacement of `registerGatewayCapabilities`**: the 16 caps that `registerGatewayCapabilities` previously registered now come from `@platform/platform-capabilities`. The factory calls `registerPlatformCapabilities(registry)` instead. The old function is removed.

#### Plugin-manager handlers (in `gateway-core/src/factory.ts`)

Six new entries in `buildGatewayHandlers`'s `gatewayHandlers` map. Each handler wraps the Plugin Manager call into the canonical `(input: YamlValue, sessionId?: string) → Promise<YamlValue>` shape.

| Handler | PluginManager call | Input contract | Output contract |
|---|---|---|---|
| `plugin.list` | `pluginManager.list()` | `{}` | `readonly InstallRecord[]` |
| `plugin.install` | `pluginManager.install(source)` | `{source: string}` | `{id, version, type, installedAt, enabled}` |
| `plugin.uninstall` | `pluginManager.uninstall(id)` | `{id: string}` | `{uninstalled: true}` |
| `plugin.enable` | `pluginManager.enable(id)` | `{id: string}` | `{id, enabled: true}` |
| `plugin.disable` | `pluginManager.disable(id)` | `{id: string}` | `{id, enabled: false}` |
| `plugin.reload` | `pluginManager.reload(id)` | `{id: string}` | `{id, version, reloadedAt}` |

All six handlers are owner=`"plugin-manager"`. Dispatch already routes `plugin-manager` to `gatewayHandlers` (`packages/gateway-core/src/dispatch.ts:50`). No dispatch change needed.

#### System handlers (in `gateway-core/src/factory.ts`)

Three new entries. Each is a kernel-direct read.

| Handler | Logic | Output |
|---|---|---|
| `system.info` | `return { name: "agentide", version: PKG_VERSION }` | `{name: string, version: string}` |
| `system.version` | Same as `system.info` (one source of truth) | `{version: string, buildHash: string \| null}` — `buildHash` is always `null` in v1 |
| `system.health` | `return { status: "ok" }` | `{status: "ok"}` (per GRILL U2 / Phase 0.5 verdict) |

All three are owner=`"gateway"`. No dispatch change.

#### `checkAuthz` upgrade

The `*` wildcard in the namespace segment (`parts[1]`) is treated as "matches any required namespace." No other wildcard form is supported.

```ts
function tierCovers(grantedScope: string, requiredScope: string): boolean {
  const gr = rank(grantedScope);
  const req = rank(requiredScope);
  if (gr === null || req === null) return false;
  const grantedParts = grantedScope.split(".");
  const requiredParts = requiredScope.split(".");
  if (grantedParts.length < 2 || requiredParts.length < 2) return false;
  if (grantedParts[0] !== requiredParts[0]) return false;
  // NEW: namespace wildcard
  if (grantedParts[1] === "*" || requiredParts[1] === "*") {
    return gr >= req;
  }
  if (grantedParts[1] !== requiredParts[1]) return false;
  return gr >= req;
}
```

A scope of `platform.*.read` (rank 1) now covers `platform.session.read` (rank 1, same kind, namespace wildcard → match). A scope of `platform.*.write` covers both `platform.plugin.write` and `platform.session.write`. The wildcard does NOT cross kind (`platform.*.read` does NOT cover `runtime.*.read`).

#### CLI filter flags

`runCapability` in `packages/agentide/src/cli.ts:200-231`:

```ts
if (sub === "list") {
  const ownerFilter = getFlag(flags, "owner", "");
  const tierFilter = getFlag(flags, "tier", "") as "read" | "write" | "";
  let list = platform.capabilityRegistry.list();
  if (ownerFilter) {
    list = list.filter(c => /* fetch full record happens here */ ...);
  }
  // ...
}
```

`registry.list()` returns `CapabilityCard` (lacks `owner`). To filter by owner, either:
- (a) Use `registry.search(query)` if the registry exposes an owner filter (it does not — would need a new method).
- (b) For each `name`, call `registry.describe(name).capability` and filter by `owner`. Cleaner; no registry change.

Option (b) is chosen. The CLI iterates `list()` → for each `name`, calls `describe(name)` → reads `owner` → applies filter. **Perf note**: this is N×M calls (N total caps, M filter iterations). For v1's ~30 caps it's sub-millisecond and the command is an operator-only path. Future enhancement: a `registry.listOwners()` (or `registry.listAll()` that returns full records) helper makes this O(1). Not a blocker for v1.

### 2.4 Frontend changes

None. (No browser-side work in v1.)

## 3. Dependency Analysis

The PRD explicitly states zero new runtime dependencies. The pack uses only two first-party packages already in the workspace:

### 3.1: `@platform/capability-registry`

**Version**: workspace `*`
**Purpose**: Target of `registerPlatformCapabilities(registry)`. The `cap` helper returns `CapabilityRecord` (imported as a type).

**opensrc inspection** (already run during gateway-core Phase 0.5):

```bash
opensrc path @platform/capability-registry
```

Source at `packages/capability-registry/src/`.

- `index.ts:32-90` confirms `register(owner, manifest)` does cross-owner collision check; throws on collision; returns `RegisterResult { added, updated, removed }`.
- `types.ts:30-43` confirms `CapabilityRecord` shape — `name`, `version`, `type`, `description`, `permissions`, `owner` (plus `inputSchema` / `outputSchema` we don't set).

**Findings**: Source confirms the registry diffs against the owner's previous state. Re-registering on restart is a no-op (no added/updated/removed). The function throws `Error` on cross-owner collision — a string message, not a typed error. The new package must NOT call `register` twice with conflicting owners; the factory's call order is the migration concern (see §4.2).

**Why chosen over alternatives**: N/A — the only capability registry. Tier 1.

### 3.2: `@platform/plugin-manager`

**Version**: workspace `*`
**Purpose**: NOT a direct import in `@platform/platform-capabilities`. The 6 `plugin.*` handlers live in `gateway-core`'s `buildGatewayHandlers` and call `pluginManager` (which is passed into the factory). This package only registers the *capability records* under owner `"plugin-manager"`; the dispatcher's owner-prefix routing (already wired) is what routes the call to the handlers.

**opensrc inspection**: N/A — same source as gateway-core's analysis (`packages/plugin-manager/src/`). `PluginManager` interface at `types.ts:164-174` confirms 9 methods we wrap.

**Findings**: 6 of the 9 methods are exposed as capabilities: `install`, `uninstall`, `enable`, `disable`, `reload`, `list`. The other 3 (`installFromRegistry`, `update`, `get`) are out of scope for v1 caps — `installFromRegistry` is a BI[16] marketplace path, `update` is the same as `install` for our purposes (deferred to a later pack), and `get` is a client-side concern.

**Why chosen over alternatives**: N/A.

### 3.3: No new external deps

The pack does not add any third-party dependency. No `opensrc` of a new package is needed.

### Summary table

| Package | Version | Purpose | Source-confirmed behavior | Alternatives rejected |
|---|---|---|---|---|
| `@platform/capability-registry` | workspace | `register()` target for `registerPlatformCapabilities` | `register` diffs vs owner state; throws on cross-owner collision | N/A — only registry |
| `@platform/plugin-manager` | workspace | Indirect — `plugin.*` handlers in gateway-core call `pluginManager` | 9 methods; `install(input.source)`, `uninstall(id)`, etc. | N/A — only plugin manager |

## 4. Migration Strategy

### 4.1 Additive phase

The new package is entirely additive. `@platform/platform-capabilities` registers 25 caps with the same `version: "1.0.0"` that the factory currently uses. The new `plugin.*` and `system.*` records are new (no migration). The 16 migrated records replace the 16 existing records under different owners — see §4.2 for the transition.

### 4.2 Migration / transition phase

The 16 caps change owners + permissions:

| Cap | Before | After |
|---|---|---|
| `session.create` | owner=`gateway`, perm=`platform.session.create` | owner=`session-manager`, perm=`platform.session.write` |
| `session.resume` | owner=`gateway`, perm=`platform.session.read` | owner=`session-manager`, perm=`platform.session.write` |
| `session.destroy` | owner=`gateway`, perm=`platform.session.delete` | owner=`session-manager`, perm=`platform.session.write` |
| `session.touch` | owner=`gateway`, perm=`platform.session.write` | owner=`session-manager`, perm=`platform.session.write` |
| `session.list` | owner=`gateway`, perm=`platform.session.read` | owner=`session-manager`, perm=`platform.session.read` |
| `tenant.create` | owner=`gateway`, perm=`platform.tenant.write` | owner=`gateway`, perm=`platform.tenant.write` (no change) |
| `tenant.list` | owner=`gateway`, perm=`platform.tenant.read` | owner=`gateway`, perm=`platform.tenant.read` (no change) |
| `tenant.suspend` | owner=`gateway`, perm=`platform.tenant.write` | owner=`gateway`, perm=`platform.tenant.write` (no change) |
| `tenant.delete` | owner=`gateway`, perm=`platform.tenant.write` | owner=`gateway`, perm=`platform.tenant.write` (no change) |
| `capability.list` | owner=`gateway`, perm=`platform.capability.read` | owner=`capability-registry`, perm=`platform.capability.read` |
| `capability.describe` | owner=`gateway`, perm=`platform.capability.read` | owner=`capability-registry`, perm=`platform.capability.read` |
| `gateway.status` | owner=`gateway`, perm=`platform.gateway.read` | owner=`gateway`, perm=`platform.gateway.read` (no change) |
| `gateway.metrics` | owner=`gateway`, perm=`platform.gateway.read` | owner=`gateway`, perm=`platform.gateway.read` (no change) |
| `gateway.configuration` | owner=`gateway`, perm=`platform.gateway.read` | owner=`gateway`, perm=`platform.gateway.read` (no change) |
| `auth.token.issue` | owner=`gateway`, perm=`platform.token.issue` | owner=`gateway`, perm=`platform.token.write` |
| `auth.token.revoke` | owner=`gateway`, perm=`platform.token.issue` | owner=`gateway`, perm=`platform.token.write` |

**Single-state migration**: the factory's `createGateway` calls ONE registration function (`registerPlatformCapabilities(registry)`) instead of `registerGatewayCapabilities`. The old function is removed in the same commit. There is no "old + new coexisting" window — the registry always sees the new state.

**Why four `register` calls, not one**: the registry's `register` produces `removed` entries per-owner when the new manifest omits a previously-held cap. The diff operates on the owner's manifest in isolation — it does NOT release records held by OTHER owners. So a single `register("platform-capabilities", { owner: "platform-capabilities", capabilities: ALL_25_CAPS })` would fail the cross-owner collision check on upgrade: the legacy `session.create@1.0.0` is still in the global store under `owner="gateway"`, and re-registering it under `owner="session-manager"` would throw.

The chosen seam: re-register each owner with its own subset. The first call re-registers `gateway` with ONLY the 12 caps it legitimately owns (4 tenant.* + 3 gateway.* + 2 auth.token.* + 3 system.*). The registry's diff removes the 7 legacy caps under `gateway` whose owners have moved (5 session.* + 2 capability.*) from the global store. The subsequent three calls register the remaining 13 caps under `session-manager` (5), `capability-registry` (2), and `plugin-manager` (6) — each with no global collision.

```ts
async function registerPlatformCapabilities(registry: CapabilityRegistry): Promise<void> {
  // Phase 1: re-register "gateway" with only the 12 caps it legitimately owns.
  // The registry's diff removes the 7 legacy caps under "gateway" (5 session.* + 2 capability.*).
  await registry.register("gateway", {
    owner: "gateway",
    capabilities: GATEWAY_OWNED_CAPS, // 12 caps: 4 tenant.* + 3 gateway.* + 2 auth.token.* + 3 system.*
  });

  // Phase 2: register the rest under their real owners.
  await registry.register("session-manager", {
    owner: "session-manager",
    capabilities: SESSION_CAPS, // 5 caps
  });
  await registry.register("capability-registry", {
    owner: "capability-registry",
    capabilities: CAPABILITY_CAPS, // 2 caps
  });
  await registry.register("plugin-manager", {
    owner: "plugin-manager",
    capabilities: PLUGIN_CAPS, // 6 caps (new)
  });
}
```

**Total: 12 + 5 + 2 + 6 = 25 caps** (per the PRD table).

**On a fresh install**: phase 1's `register("gateway", { ...12 caps })` adds all 12 (no prior state). Phase 2 adds 5 + 2 + 6 = 13. Total 25. ✓

**On an upgrade from pre-BI[6]**: phase 1's `register("gateway", { ...12 caps })` produces `removed: [session.create, session.resume, session.destroy, session.touch, session.list, capability.list, capability.describe]` (7 caps under `gateway` that no longer claim). Phase 2 then registers the new owners — clean.

Each call is idempotent on restart (the diff is empty after the first run). The cross-owner collision check passes because each call's records are unique to that owner.

**Why downgrades are broken**: the registry's `register` is forward-only. A downgrade to a pre-BI[6] `registerGatewayCapabilities` would re-register `session.create@1.0.0` under `owner="gateway"`, but the global store still has `session.create@1.0.0` under `owner="session-manager"` — the cross-owner collision throws. A downgrade requires a manual `agentide capability reset` step (out of scope for v1; documented in the migration guide).

### 4.3 Compatibility rails

Two compatibility shims needed during the transition window:

1. **Permission rename shim**: callers who previously used `platform.session.create` will get `INSUFFICIENT_SCOPE` after the rename. The blast radius is operators who minted tokens before BI[6] ships. Documented in the migration guide: re-issue tokens with the new permission names. No code shim — the rename is part of the change.

2. **Owner migration shim**: callers who previously called `capability.list --owner gateway` expecting `session.*` would now see only `tenant.*` / `gateway.*` / `auth.*` / `system.*`. The migration is to `--owner session-manager` (etc.). No code shim — the change is the operator-visible feature.

The `agentide init` command's bootstrap token is unaffected — it uses `scope: ["*"]` which the bare-wildcard rule covers.

### 4.4 Rollback plan

If a critical bug is found post-release:

1. Operators stop the platform (`agentide stop`).
2. Reinstall prior version (via `agentide upgrade --rollback` binary, or `docker run ...:<prev-tag>`).
3. The prior version's `registerGatewayCapabilities` re-registers the 16 caps under `owner="gateway"`. The prior version's `checkAuthz` is unchanged (no `*` wildcard). The prior version's handlers are unchanged.

**Data loss risks**: the audit log is append-only and never re-read by the registry. Tenant records are persisted to `tenants.json` and are not affected by capability ownership changes. No data loss.

The `CHANGELOG` and the upgrade path are explicit: the rename is part of the release; pre-existing tokens must be re-issued.

## 5. Open Questions

- [ ] **Q-1**: Should the `registerPlatformCapabilities` migration also fire on a downgrade (revert the owner migration)? The current plan migrates forward only. A downgrade would leave the registry in the new state — the prior version's `registerGatewayCapabilities` would then re-register the 16 caps under `gateway`, which would FAIL the cross-owner collision check (the new owners still hold them). The factory on downgrade would throw and refuse to start. **Resolution**: downgrade requires a manual `agentide capability reset` step (out of scope for v1). Documented in the migration guide.
- [ ] **Q-2**: Should the `system.version` cap return `buildHash: null` (literal null) or omit the field entirely? The PRD says `buildHash` is "reserved but always null." Returning `null` is more explicit and matches the documented contract. **Decision: return `null`.**
- [ ] **Q-3**: Should the CLI `--owner` filter match partial owners (e.g., `--owner plugin` matches `plugin-manager`, `plugin:foo`)? The current plan is exact match. **Decision: exact match in v1. Partial match is a POST-v1 enhancement.**

## 6. Deferred Items

| Item | Reason deferred | Suggested future trigger |
|---|---|---|
| `runtime.*` caps (platform-owned runtime management) | No Runtime Manager pack exists in v1. Reserved for a future pack. | When a Runtime Manager pack is scheduled |
| `marketplace.*` caps | BI[16] Plugin Marketplace. | BI[16] |
| `dashboard.*` caps | BI[13] Dashboard. | BI[13] |
| Tenant-scoped capability filtering on `capability.list` | Per BI[7] permission-tiering. Today's `capability.list` returns all caps, filtered by caller's scope only via `platform.capability.read` check. | BI[7] |
| `platform.*.write` wildcard | The user might want a single scope to cover every write-tier cap. The current PR ships `platform.*.read` only. The wildcard is symmetrical — extending `checkAuthz` to support both is a one-line change. Decision deferred to user feedback. | When a use case for it appears |
| Multi-process / health check across nodes | `system.health` v1 returns `{status: "ok"}` always. v2 adds liveness probes for runtime managers. | When v2 ships runtimes |
| `system.version` returning real `buildHash` from CI | v1 always returns `null`. | When CI ships signed builds |
| Capability deprecation semantics | Out of scope. | BI[16] marketplace |
| Auto-merge of `plugin.install` from registry (vs. local source) | `installFromRegistry` exists in Plugin Manager but is not exposed as a capability in v1. | BI[16] marketplace |
| Per-capability `version` filter on `capability.list` | v1 lists only latest version. | When multi-version matters |
| `validateRecord` additions (e.g., owner-string format validation) | Out of scope. The registry already validates `name` and `version` format. | When owners become user-supplied (today they're hard-coded) |
