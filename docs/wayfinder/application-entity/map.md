# application-entity — Wayfinder map

> **Map title:** application-entity — finding the way to a first-class
> Application object with an immutable UUID, fixing the multi-tenant
> isolation bypass documented in the production audit.
>
> **Status:** charting complete (0/8 tickets closed, all open). Live tracker:
> this file + the 8 child ticket files.

## Destination

`Application` is a first-class entity in the platform, with a platform-
generated UUID (the only identity the runtime ever keys on) and a
human-readable name (display only). Every place that today keys by
`callerId` (registry, capability owner, rate-limit bucket, audit
log, session attach) keys by `applicationId` instead. Renaming an
application is a stable, no-references-broken operation. Two tenants
can name their apps "portfolio-service" with zero risk of cross-tenant
routing. The audit's Section 1.1 (Multi-Tenant Isolation Bypass via
Backend SDK Connection Keying) is closed.

The build itself happens via `delivery: feature-pipeline` once the way
is clear. Per Wayfinder's default mode, this map plans, does not execute.

## Notes

- **Decisions already locked** in
  `docs/features/application-entity/GRILL-application-entity.txt` —
  9 questions with answers. The map does NOT re-litigate them; tickets
  here are the OPEN questions surfaced by the grill + the map's
  "Not yet specified" section.
- **Domain:** multi-tenant AI agent platform. The Application is the
  identity under which an SDK process dials the Gateway and registers
  capabilities. Today the same field (`callerId`) plays both the
  identity and the display name; this map formalizes them separately.
- **Standing preferences:** Wayfinder plan-only mode. Self-hosted
  Gateway assumed. No marketplace, no dev portal, no per-app RBAC.
  Pre-1.0 — no production users to migrate.
- **Assumed already shipped:** everything in `docs/Feature_Backlog.md`
  Tier 1-3. Map invalidates if any reopened decision affects the
  Grill's locked answers (e.g. RS256 token signing would change the
  claim format).
- **Truthfulness rule:** if a ticket's resolution contradicts the
  Grill or another open ticket, update *the map and the affected
  tickets*, not just the answer. Drift entries go in `docs/drift.md`.
- **Delivery route for the eventual build:** `feature-pipeline`.
  The 8 tickets resolve decisions; the build is a separate run.
- **Plain-English analogy:** the Application is a "company email
  address" — the same human can change their display name forever, but
  the address (the lookup key) is permanent. Within one company, two
  people can have the same display name ("Alex") but their addresses
  are unique.

## Open Tickets (frontier)

All tickets closed. The map is **done** — way is clear to the destination.

Way was walked: GRILL (9 questions) → T1 (ULID format) → T2 (auto-provision) → T3 (app-removed permissive) → T4 (sync ack) → T5 (wire versioning) → T6 (SDK research) → T7 (SDK wire changes) → T8 (invasion prototype).

**Delivery route:** `feature-pipeline`. Per the wayfinder default, the map
plans; the build is a separate run.

## Decisions so far

- **Application entity** shape — `Application { id, tenantId, name,
  createdAt }`. UUID is the only key the runtime ever uses; name is
  display only. See `docs/features/application-entity/GRILL-application-entity.txt`.

- **JWT claim** — `sub: { tenantId, applicationId, applicationName }`.
  No connect-time resolution. Token IS the identity.

- **Wire protocol** — `sdk.auth` request shape unchanged on the SDK
  side. Server adds a new `sdk.auth.ack` response carrying
  `{ applicationId, applicationName }`. Errors before close use a
  structured `sdk.auth.error` carrying the code.

- **Capability owner** — `backend-sdk-${tenantId}:${applicationId}`.
  The `backend-sdk-` prefix is the dispatch discriminator (kept for
  parity with `plugin-*` and `gateway-*`); the colon makes the
  composite parseable.

- **Rate-limit bucket** — key = `${tenantId}:${applicationId}`.
  Per-application unit.

- **Lifecycle events** — `application.created`, `application.renamed`,
  `application.removed`. Mirror the `tenant.*` and `session.*`
  patterns.

- **Deletion semantics** — every connection registered under the
  removed application is closed with `1000 application-removed`; every
  in-flight invocation rejected with `GATEWAY_APPLICATION_REMOVED`
  (retryable: false).

- **Rename of `callerId`** — one-shot, no alias. CallerIdentity,
  TokenClaims, AuditRecord, RateLimitBucket, all renamed.

- [**ID generation strategy**](tickets/id-generation-strategy.md) (T1, closed
  2026-07-31) — ULID in the format `app_<26-char-ulid>`. Sortable by creation time
  (first 10 chars = millisecond timestamp); ~5KB dep; monotonic within a single
  process; multi-replica safe (no coordinator). Rules out UUIDv4 (no sortability),
  UUIDv7 (more complexity, no marginal benefit), numeric auto-increment (blocks
  multi-replica), hash-derived (no predictability). Implementation seed:
  `packages/application/src/id.ts` — `createApplicationId(): string`.

- [**Application provisioning: auto-provision on first connect**](tickets/application-provisioning.md)
  (T2, closed 2026-07-31) — permissive default: the server auto-provisions an
  Application on first connect using the token's `applicationName`. Operators who want
  strict mode set `application.auto_provision: false` in the backend-runtime config
  and must `agentide app create` first. Token issuance is the recommended path;
  auto-provision is the fallback for dev. Rule out: strict-only default (dev friction),
  per-env default flip (operators with mixed dev/prod need a per-process knob).

- [**App-removed connect-time behavior**](tickets/app-removed-connect-time.md)
  (T3, closed 2026-07-31) — permissive: accept the connection, immediately close with
  `1000 application-removed`. Token's signature is the trust anchor; removal is a
  runtime signal, not an identity check. No cross-check on every connect (latency cost
  with minimal security gain). SDK sees `sdk.auth.error { code: APPLICATION_REMOVED }`
  followed by close. Rule out: strict pre-registered cross-check (DB hit per connect),
  silent acceptance (stale connections).

- [**SDK auth.ack timing**](tickets/sdk-auth-ack-timing.md) (T4, closed 2026-07-31) —
  synchronous: server sends `sdk.auth.ack` in the same message loop tick as the auth
  verification. No new state machine step on the SDK side. SDK's `state().applicationId`
  is null only during the brief connecting window. No retransmission (sync ack on a
  live socket can't be lost). Rule out: async ack with retransmission (over-engineered),
  fire-and-forget (state machine inconsistency).

- [**Wire protocol versioning at this refactor**](tickets/wire-protocol-versioning.md)
  (T5, closed 2026-07-31) — add a `protocolVersion` field to wire messages. Default `1`
  for the current protocol. Backward-compat is implicit (old SDKs without the field
  get v1). Forward-compat is a future pack (v2 negotiation). Cost: one field per
  message. Benefit: future versions fail loudly instead of silently dropping. Rule
  out: no version field (audit Section 3.5's concern), mandatory handshake (breaks
  implicit backward-compat), separate version message (one field is cheaper).

- [**SDK behavior change (sdk-node + sdk-browser)**](tickets/sdk-behavior-change.md)
  (T6, closed 2026-07-31) — research artifact produced during feature-pipeline at
  `docs/wayfinder/application-entity/research/sdk-behavior-change.md`. Skeleton
  enumerates seven questions the artifact answers: connection-client ack consumption,
  `state()` shape additions, registration impact, reconnect path, browser mirror,
  backward-compat matrix, wire-version consumer.

- [**sdk-node + sdk-browser wire-protocol changes**](tickets/sdk-wire-protocol-changes.md)
  (T7, closed 2026-07-31) — six concrete SDK changes mirrored across both SDKs:
  `connect()` awaits `sdk.auth.ack`; `state()` adds `applicationId`/`applicationName`;
  no on-disk persistence; `sdk.auth.error` is terminal; no new EventBus event;
  sdk-browser mirrors all. Rule out: on-disk persistence (rotation drift),
  new lifecycle event (noise), retry on auth error (wrong layer).

- [**Cross-tenant invasion test**](tickets/cross-tenant-invasion-test.md)
  (T8, closed 2026-07-31) — prototype artifact produced during feature-pipeline at
  `docs/wayfinder/application-entity/prototype/cross-tenant-attack.mjs`. The script
  boots two fake tenants, connects two SDKs with the same `callerId`, demonstrates
  pre-fix leak and post-fix isolation, prints PASS/FAIL.

All locked 2026-07-31 in `docs/features/application-entity/GRILL-application-entity.txt`.

## Not yet specified

Fog that becomes specifiable as the frontier advances:

- **Per-application permissions** — does the Application become a
  scope carrier (e.g., `app:portfolio-service`) or does the scope
  stay on the token claim entirely? The Grill ruled this out of v1
  (scope stays on token), but the data model should not preclude
  future per-app scope. (No ticket — punted to v2.)
- **Application metadata fields** — beyond `id, tenantId, name,
  createdAt`: `enabled`, `description`, `ownerPrincipal`,
  `lastSeenAt`, `tags`. The Grill ruled the entity on the first four;
  `enabled` is the only one likely v1. (No ticket — implementation
  detail in feature-pipeline.)
- **Storage shape** — single `applications.json` (mirrors
  `tenants.json`) vs per-tenant directory. (No ticket — defaulted to
  single file in the Grill; revisit if performance shows otherwise.)
- **Concurrent rename semantics** — last-write-wins is the simplest;
  explicit lock is overkill. (No ticket — defaulted to LWW.)
- **Cross-tenant capability visibility filtering** — independent of
  the connection keying fix; the audience-of-one filter (a caller
  in tenant A should only see caps registered by tenant A's apps) is
  a separate capability-registry patch. The audit's Section 1.1
  closes the *routing* leak; the *visibility* layer is a separate
  concern. (No ticket here — separate map when desired.)

## Out of scope

- `browser-runtime` — separate map. The Application entity is platform-
  bound; runtime plugins (browser, docker, etc.) are a separate
  capability namespace.
- Service plugins and developer plugins — no Application entity on the
  plugin side; plugin manager has its own install-record identity.
- Marketplace listing and dev portal — separate maps.
- Per-app role hierarchy — separate map. Application v1 is identity only;
  RBAC is out of scope.
- Multi-region replication — separate map. v1 is single-process.
- Cross-tenant capability visibility filtering — touches
  capability-registry; separate map. The audit's Section 1.1 is the
  *routing* fix; visibility is a distinct concern.

## References

- `docs/.reports/Agentide Production Audit_ Security, Performance & Design Patterns.md`
  Section 1.1 — the bug this map fixes.
- `docs/features/application-entity/GRILL-application-entity.txt` — the
  Grill decisions (9 questions locked). Source of truth for everything
  in "Decisions so far" above.
- `packages/backend-runtime/src/registry.ts` — the bug's surface (keyed
  by `appId` only).
- `packages/backend-runtime/src/server.ts:116` — where `appId = callerId`
  is derived from the JWT.
- `packages/backend-runtime/src/dispatch.ts:78-95` — where the lookup
  happens by parsed `appId` from the owner.
- `packages/gateway-core/src/dispatch.ts:122` — gateway-side dispatch
  routing.
- `packages/gateway-core/src/auth.ts:36` — `alg: "HS256"` claim; the
  token contract we extend.
- `packages/gateway-core/src/types.ts:113-118` — `TokenClaims.sub` shape
  that gains `applicationId` + `applicationName`.
- `packages/gateway-core/src/types.ts:49-57` — `CallerIdentity` shape
  that gets renamed.
- `docs/Feature_Backlog.md` — Tier 1-3 invariant.
- `docs/CONTEXT.md` — Q8 tenant isolation, Q7 rate limiting, the
  invocation delegation pattern are the surface contracts we modify.
- `docs/drift.md` — append new drift entries here when a ticket
  resolution shifts the documented intent.
- Sibling map: `docs/wayfinder/sdk-browser/map.md` — established format
  for tracker-style planning.
