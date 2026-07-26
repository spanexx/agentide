# PRD: Capability Registry

## Status

- Type: Product requirements document
- Audience: Platform engineering, QA
- Scope: In-memory catalog that stores every capability offered by applications, runtime plugins, and the platform core, and serves read-only discovery of that catalog.
- Status: Draft 2026-07-26 — grill answers locked; awaiting user approval before moving into TRD/FLOW/IMPL.

## Summary

The Capability Registry is the platform’s shared list of capabilities. It
holds the discovery record for every Business, Platform, and Runtime
capability that any connected source (an application, a runtime plugin,
or platform core later) has announced via a Capability Manifest or a
Runtime Manifest. It does not execute anything. It only answers two
kinds of question: “what can this system do right now?” and “tell me
more about that one thing.”

This first version stores the catalog in memory and rebuilds it on
startup. It exposes internal write paths so that owners can register a
full manifest in one call, and public read paths so that the Gateway,
CLI, MCP adapter, and Dashboard can browse, search, and describe. The
later `platform-capabilities` pack wraps those read paths as
agent-callable `capability.*` features.

## Problem

The platform needs a single source of truth for “what exists right now.”
Today the only way to know what an AI agent can do is to ask each
connected source separately. That does not scale:

- The Gateway cannot decide routing without knowing which Business,
  Platform, and Runtime capabilities exist at the moment a request
  arrives.
- The CLI cannot show a useful help screen without a combined view.
- The MCP adapter cannot translate an agent’s `capability.list` call
  without one list to draw from.
- The Dashboard cannot show the live inventory of registered
  capabilities without a shared store to query.

Without a shared catalog, every consumer reimplements discovery, every
manifest is parsed in many places, and “what changed?” has no
well-defined answer.

## Product Goals

1. Store the full discovery record for every capability whose source
   has published a manifest: name, version, type (`business`,
   `platform`, `runtime`), description, input and output schemas,
   permissions, and owner.
2. Let an owner register, update, or replace their full capability set
   with one manifest-style call, rather than registering capabilities
   one at a time.
3. When one owner sends a new full list, replace that owner’s previous
   list and remove entries that are no longer in the new list, so that
   hot reload and plugin removal leave the catalog clean.
4. Treat `(name, version)` as the unique identity of a capability, so
   `customer.read v1` and `customer.read v2` can both be registered at
   the same time during migration.
5. Reject a clash when two different sources try to register the same
   `(name, version)` pair, so one name always points to one record.
6. Expose read functions `list`, `search`, and `describe` so the
   Gateway, CLI, MCP adapter, and Dashboard can browse, find, and
   explain capabilities.
7. Keep the catalog live: every successful register, update, and
   remove emits one list-change event (`capability.registered`,
   `capability.updated`, `capability.removed`) on the Event Bus, so
   other platform components can react without polling.

## Non-Goals

- **Executing capabilities.** The Registry only holds discovery
  records. Permission checks, input validation, and handler dispatch
  belong to the Gateway, the SDK, and the runtimes.
- **Agent-callable read capabilities.** This pack exposes registry
  read functions. Exposing them as `capability.list`,
  `capability.search`, and `capability.describe` for AI agents to
  invoke is the job of the later `platform-capabilities` pack.
- **Persistent storage.** The catalog lives in memory for v1. On
  restart, owners register their manifests again and the catalog is
  rebuilt.
- **Public write surface.** No `capability.register`,
  `capability.update`, or `capability.remove` for AI agents or other
  external callers in this version.
- **Capability execution lifecycle events.** Run-time events like
  `capability.started`, `capability.completed`, `capability.failed`
  belong to whichever pack executes capabilities, not to the
  Registry.
- **Schema validation beyond well-formed metadata.** A malformed
  capability name, an obviously empty description, or a missing
  version is rejected. Deep JSON-schema validation of input/output
  schemas is a separate concern.

## Canonical Product Language

All terms already live in `CONTEXT.md`. This PRD binds the following
glossary entries to concrete behaviour in this pack:

- **Capability Registry** — the catalog of every capability available
  to the platform. Discovery only, no execution. The Registry in this
  pack is the concrete realisation of that abstract role.
- **Capability** — the smallest invocable unit, `<domain>.<action>`,
  typed `business`, `platform`, or `runtime`. Stored in the catalog
  with name, version, description, input schema, output schema,
  permissions, and owner.
- **Capability Manifest** — the application’s declarative list,
  published at startup. The Registry treats one full manifest from
  one owner as one atomic operation: register or replace.
- **Plugin Manifest** — the runtime plugin’s equivalent of a
  Capability Manifest. Same shape from the Registry’s point of view:
  one owner, one full list.
- **Event / Event Bus** — the bus carries this pack’s list-change
  events (`capability.registered`, `capability.updated`,
  `capability.removed`) under the `capability.*` namespace. The bus
  semantics (sync dispatch, wildcard topics, frozen payloads,
  `event.*` reserved for internal use) come from the
  `event-bus` pack and are not redefined here.
- **Owner** — the source of a manifest. One application, one runtime
  plugin, or (later) platform core. The Registry keeps manifests
  owner-scoped so a manifest from one owner cannot clobber a record
  that belongs to another.

No new glossary terms are introduced by this PRD.

## Product Scope

### Registering — owner-scoped write path

The Registry accepts write calls only from inside the platform. An
owner publishes one full manifest at a time. The manifest names the
owner, the version of the manifest itself, and the list of capabilities
it offers. The Registry:

1. Validates that each capability record is well-formed: name matches
   the `<domain>.<action>` rule, version is a non-empty string,
   description is present, type is one of `business`, `platform`,
   `runtime`, permissions is an array of scope strings.
2. Checks for clashes on `(name, version)` against records owned by a
   different owner. A clash is rejected with a clear error so the
   caller can decide whether to bump the version, change the name, or
   treat the existing record as authoritative.
3. Replaces that owner’s previous list with the new list. Capabilities
   that the owner previously registered and no longer appears in the
   new manifest are removed. Capabilities that appear in both lists
   with changed metadata are updated.
4. Emits one list-change event per affected capability, in
   registration order, before returning.

### Reading — public read path

The Registry exposes three read functions:

- `list()` returns a short card per registered capability: name,
  version, type, and a one-line description. Used for browsing and for
  dashboards that want a compact inventory.
- `search(query)` returns the short cards of capabilities whose name
  or description contains the query as a case-insensitive substring.
  Used for ad-hoc discovery by humans and AI agents.
- `describe(name, version?)` returns the full record for one
  capability. If `version` is omitted and exactly one version exists,
  that version is returned. If multiple versions exist, the latest
  version is returned and the response clearly states which version
  was selected. If `version` is omitted and no record exists, an empty
  result is returned.

All read functions return read-only views. No mutation is possible
through the read path.

### Events — list-change surface

After a successful register, update, or remove, the Registry emits
list-change events on the Event Bus:

- `capability.registered` with the full record of the new capability.
- `capability.updated` with the previous record and the new record.
- `capability.removed` with the last known record of the removed
  capability.

These events are published after the catalog is updated, so a listener
that immediately reads the catalog sees a consistent view. They are
not emitted on every read.

### Rebuild on startup

The catalog is in memory only. On startup, the Registry is empty.
Owners (applications, runtime plugins, platform core) re-publish their
manifests at startup. The Gateway orchestrates the registration order
in a later pack. This pack does not decide startup ordering — it only
guarantees that whatever order owners register in, the resulting
catalog is consistent.

## User Stories

1. As an **Application**, I want to publish my full capability list at
   startup, so that I don’t have to register capabilities one at a
   time.
2. As a **Runtime Plugin**, I want to register my capabilities from a
   Runtime Manifest the same way an Application does, so that one
   registry code path serves both.
3. As a **Plugin Manager** (later pack), I want the Registry to drop
   the plugin’s capabilities automatically when the plugin’s manifest
   is removed, so that uninstall is a single replace-with-empty
   operation rather than a separate cleanup path.
4. As a **platform operator**, I want the Registry to reject a clash
   on `(name, version)`, so that two different sources cannot both
   claim the same discovery record.
5. As a **Gateway**, I want to call `list()` and `search()` to build
   a routing view of the system, so that requests can be matched to
   their owner without each Gateway code path parsing manifests.
6. As a **CLI**, I want to call `describe(name)` to print the full
   record of one capability, so that help output is consistent with
   what the Registry knows.
7. As an **MCP Adapter**, I want to call `list()` once per agent
   session and pass the result through, so that an AI agent can
   discover everything it can do without three separate discovery
   calls.
8. As a **Dashboard**, I want to subscribe to `capability.*` events
   so that the live inventory view updates as capabilities come and
   go, rather than polling on a timer.
9. As a **plugin author**, I want my read of the catalog to never
   mutate another record, so that I can’t accidentally corrupt
   discovery while debugging.
10. As a **future operator**, I want the registry to keep multiple
    versions of the same capability name alive side by side, so that
    I can migrate from `v1` to `v2` without removing `v1` first.

## Acceptance Criteria

- [ ] Calling the register path with one owner and one full
      capability list adds every record from that list to the
      catalog.
- [ ] Calling the register path twice from the same owner with a
      second full list replaces the owner’s previous list: entries
      that are no longer in the new list disappear, entries that are
      unchanged remain.
- [ ] Calling the register path with one owner and a list that
      collides on `(name, version)` with a record owned by a
      different owner is rejected; neither record is mutated.
- [ ] Calling the register path with a malformed capability record
      (missing name, missing version, unknown type, empty
      description) is rejected; the catalog is not mutated.
- [ ] After a successful register, the registry contains exactly one
      record per `(name, version)` pair from that owner’s manifest.
- [ ] `list()` returns a short card per registered capability and no
      other data; mutating the returned cards does not affect the
      catalog.
- [ ] `search(query)` returns short cards whose name or description
      contains the query as a case-insensitive substring, in
      registration order; an empty query returns an empty result.
- [ ] `describe(name)` with one existing version returns that
      version’s full record.
- [ ] `describe(name)` with multiple existing versions and no
      specified version returns the latest version and clearly states
      which version was selected.
- [ ] `describe(name, version)` returns that specific version’s full
      record, or an empty result if no such version exists.
- [ ] Every successful register emits one `capability.registered`
      event per added record, in registration order, with the full
      record as payload.
- [ ] Every successful update emits one `capability.updated` event
      per changed record with both the previous and new record in the
      payload.
- [ ] Every successful remove emits one `capability.removed` event
      per removed record with the last known record in the payload.
- [ ] No `capability.*` event is emitted for an unchanged record
      during a replace.
- [ ] A failed register does not mutate the catalog and does not emit
      any `capability.*` event.
- [ ] After a remove via owner-scoped replace, the removed record is
      no longer returned by `list()`, `search()`, or `describe()`.

## Rollout and Risk

- **Migration risk**: none at the registry layer — no consumer depends
  on the registry today. The Event Bus pack is already shipped, and
  this pack is the first consumer of `capability.*` events. Future
  consumers (Session Manager, Plugin Manager, Gateway) will follow the
  same internal-call pattern.
- **Compatibility risk**: low. The read functions are additive. No
  agent or external component can call them yet, since
  `platform-capabilities` does not exist. Anything that wires to the
  read functions now does so via direct registry calls.
- **Rollout strategy**: ship as a single npm workspace package
  `@platform/capability-registry` inside `agentide/packages/`, with
  `@platform/event-bus` as a workspace dependency. Land it behind no
  flag — it has no behaviour until something calls register or list.
- **Drift watch**: this pack’s read functions must match the read
  surface that `platform-capabilities` later wraps. If those names
  change (`describe` vs. `inspect`, etc.), update this PRD before
  locking the TRD.

## Out of Scope

| Item | Reason deferred |
|---|---|
| Persistent storage of the catalog | First version rebuilds on startup from owner manifests. Adding persistence is a separate decision about the storage backend. |
| Agent-callable `capability.*` features | `platform-capabilities` pack already owns this in the backlog. Keeping it separate avoids tying the registry to the gateway permission model. |
| Public `capability.register` / `update` / `remove` | v1 is internal-write / public-read only. Adding a public write surface requires a permission model that does not exist yet. |
| Schema validation of input/output schemas | Well-formed metadata is checked; deep JSON-schema validation is a separate cross-cutting concern. |
| Cross-process or cross-network catalog | The catalog is in-process for v1. Multi-gateway discovery is a different feature. |
| Default-version selection rules | “Latest wins” for unspecified version is a v1 simplification. A real semver-aware default is a future refinement. |
| Tenant isolation | Multi-tenant filtering of the catalog depends on the Tenant design still flagged as open in `CONTEXT.md`. |

## Further Notes

### Resolved design decisions

- **Identity** — `(name, version)` is the unique key.
- **Storage backend** — in-memory map, rebuilt on startup.
- **Owner scoping** — one full manifest per owner per call;
  replaces that owner’s previous list.
- **Clash policy** — reject clashing `(name, version)` from different
  owners; do not silently overwrite.
- **Read shape** — `list` returns short cards; `describe` returns
  full record; `search` looks at name and description.
- **Event surface** — `capability.registered`, `capability.updated`,
  `capability.removed`. No execution lifecycle events from this pack.
- **Event ordering** — events are emitted after the catalog is
  updated, in registration order, so listeners see a consistent view.

### Open questions carried forward (none blocking this PRD)

- Should the manifest carry an explicit owner-id format, or should
  the caller pass it as a separate parameter to the register path?
  This is a TRD-level question, not a PRD one.
- How does the Gateway decide registration order across many owners
  on startup? This belongs to a future pack and only matters if
  order changes the meaning of “latest.”

### Related documents

- Grill notes: [`GRILL-capability-registry.txt`](./GRILL-capability-registry.txt)
- Glossary: [`../../CONTEXT.md`](../../CONTEXT.md)
- Capability structure: [`../../architecture/Capability_System.md`](../../architecture/Capability_System.md)
- Manifest formats: [`../../architecture/Terminology.md`](../../architecture/Terminology.md) → Capability Manifest, Plugin Manifest
- Event bus contract: [`../event-bus/PRD-event-bus.md`](../event-bus/PRD-event-bus.md)
- Backlog entry: [`../../Feature_Backlog.md`](../../Feature_Backlog.md) → Tier 1 #2