# Agentide — Drift / Issue Log

> Running log of gaps, inconsistencies, unfinished sections, and undocumented design decisions
> found while reviewing the Agentide docs (Vision, Goals, Agentide, Terminology, Core Concept,
> Capability System, Business Capability, Platform Capabilities, Runtime Capabilities,
> Architectural Refinement V1).
>
> Update this file as review continues. Each item should stay actionable — what's wrong,
> where, and what the likely fix is.

---

## 1. Capability System doc is unfinished — RESOLVED

**Where:** `Capability system`

**Resolution (this pass):** Finished as the canonical abstract capability definition (see
`Capability_System.md` in outputs). Adds a general Capability Structure table (7 fields
common to all types), a Capability Types classification test ("what does it touch?"), a
Capability Lifecycle section, and cross-references out to Business/Platform/Runtime
Capabilities for concrete worked examples instead of duplicating them. Also surfaces the
Business/Runtime permission-tiering gap (#3) inline so a reader hits it in context rather than
only in this log.

Original problem, kept for reference: doc cut off mid-sentence at "Every capability contains
metadata" — the Capability Structure section, naming guidelines beyond the `<domain>.<action>`
convention, and any worked schema example never arrived. Its intended content was already
delivered more completely in `Business Capability`, leaving it redundant as well as
incomplete.

---

## 2. Redundant principles in Goals — RESOLVED

**Where:** `Goals` — Design Principles #1–3, #16

**Resolution (this pass):** `Goals.md` consolidates Capability First, Protocol Agnostic,
Language Agnostic, and Framework Independence into a single principle, "Agnostic by Design,"
with four sub-layers (capability/protocol/language/framework) under one unifying statement:
the platform must never hard-code an assumption about how someone communicates with it.
Remaining 14 principles renumbered accordingly. Also lightly cross-referenced #3 and #4's
resolutions into the relevant principles (Security by Default → permission tiering; Scalability
→ deployment-model permission divergence) so Goals stays consistent with the docs it governs.

Original finding, kept for reference: Capability First, Protocol Agnostic, Language Agnostic,
and Framework Independence were really one idea (agnosticism) restated at four different
layers (capability naming, communication protocol, programming language, application
framework).

---

## 3. Permission tiering is inconsistent between Platform and Runtime Capabilities — RESOLVED

**Where:** `Platform Capabilities` vs. `Runtime Capabilities`

**Resolution (this pass):** `Runtime_Capabilities.md` now defines a formal three-tier
permission convention — `runtime.<namespace>.read` / `.act` / `.destructive` — with a worked
table mapping every named example capability (browser, docker, git, filesystem) to a tier.
Three tiers rather than Platform's two, because runtime actions include a distinct
irreversible/high-impact category (`docker.remove`, `git.push`, `filesystem.delete`) that
Platform's plugin-management actions don't really have. `Capability_System.md` and
`Business_Capability.md` both cross-reference this so the convention is visible wherever
permissions are discussed, not just buried in one doc.

Original finding, kept for reference: Platform Capabilities modeled fine-grained read/write
scopes (`platform.plugin.read` vs. `platform.plugin.install`); Runtime Capabilities used one
flat scope per action with no split, meaning e.g. `browser.screenshot` (low risk) and
`browser.click` (can submit orders, delete data) both sat under one undifferentiated
`runtime.browser.*` grant.

**Remaining follow-up:** Business Capabilities was reviewed against the same question and,
for now, doesn't need the same tiering — each Business Capability is already a single named
action rather than a broad namespace. Flagged in `Business_Capability.md` as something to
revisit if that changes as the capability catalog grows.

---

## 4. No SaaS vs. self-hosted permission split documented — RESOLVED

**Where:** `Agentide` (Deployment Models) × `Platform Capabilities` (Permissions)

**Resolution (this pass):** `Platform_Capabilities.md` adds a new "Permission Ownership by
Deployment Model" section spelling out the split explicitly: self-hosted operators may hold
the full `platform.*` range; in hosted/SaaS deployments, write-tier `platform.plugin.*`
permissions are reserved for the platform operator only, tenants get Business Capability
registration (not a `platform.*` permission at all) plus read-tier platform visibility, and
session-scoped permissions are limited to the tenant's own sessions. Explicitly cross-linked
to Terminology's Tenant entry, which still flags multi-tenancy as not fully designed — so this
section is marked as directional intent, not a finished spec.

Original finding, kept for reference: the logical implication that `platform.plugin.install`
should be operator-only in hosted SaaS but available to the admin in self-hosted deployments
was never actually stated anywhere; Deployment Models and Platform Capabilities' Permissions
section never cross-referenced each other.

**Remaining follow-up:** Full tenant isolation semantics (per-tenant session boundaries,
billing/quota interaction with permissions, etc.) are still open — this resolution covers the
plugin-install question specifically, not the broader Tenant design.

---

## 5. No plugin distribution mechanism specified — RESOLVED

**Where:** `Agentide` (Plugin Manager, Plugin System) × `Terminology` (Plugin Manager)

**Resolution (this pass):** New standalone document `Plugin_Marketplace.md` defines the full
mechanism:
- A public **Plugin Registry** with three trust tiers (Official / Verified / Community),
  each with different review, signing, and default-visibility rules
- A **publishing flow** from author submission through automated checks, optional human
  review, signing, and publication/deprecation
- New read-only **Platform Capabilities** (`marketplace.search`, `marketplace.describe`,
  `marketplace.versions`) under a new `marketplace.*` category, gated by a low, widely-
  grantable `platform.marketplace.read` permission — deliberately separate from `plugin.list`
  (installed) and from `plugin.install`'s existing high permission bar
- A step-by-step **installation resolution** flow (id → registry lookup → checksum/signature
  verification → collision check → dependency check → standard plugin lifecycle)
- A **private-source install path** (`plugin.install --source <path/url>`) for customer-built
  plugins that should never be published publicly
- Explicit **interaction with deployment models** — self-hosted operators configure their own
  trust-tier policy; hosted/SaaS operators set a shared default (most plausibly
  Official+Verified only), while `plugin.install` itself remains exactly as gated as
  established in #4

`Platform_Capabilities.md` was updated to add the `marketplace.*` category.
`Agentide.md` (Plugin Manager section, Phase 10) and `Terminology.md` (Plugin Manager entry)
now point to this document instead of flagging it as unspecified.

**Explicitly left open within the new document** (not blockers to adopting the mechanism,
but real follow-up work): review capacity/SLA for reaching Verified tier, revocation handling
for already-installed plugins found malicious after the fact, monetization/licensing, and
runtime sandboxing (a related but distinct concern from install-time trust).

Original finding, kept for reference: Plugin Manager was documented to install/update/remove
plugins, but no doc explained where plugins come from — no marketplace, registry, or
discovery capability existed for available-but-not-installed plugins.

---

## 6. Future runtimes have no build-ownership model — RESOLVED

**Where:** `Agentide` (Future Runtimes), `Runtime Capabilities` (namespace examples)

**Resolution (this pass):** `Agentide.md → Section 7 (Future Runtimes)` now defines three
ownership tracks — core-team-built, community-contributed, customer-built — with guidance on
which kind of runtime fits each track, and states explicitly that no future runtime currently
has a track assigned, and none should move onto the scheduled roadmap (Phase 9) until it does.

Original finding, kept for reference: Git/Docker/Kubernetes/Database/File runtimes were
referenced repeatedly across docs as if they exist, but only Browser Runtime and Backend
Runtime had real implementation detail or an assigned roadmap phase.

**Remaining follow-up:** actually assigning a track to each specific runtime is still an open
decision for whoever plans the roadmap next — this resolution provides the framework, not the
per-runtime decision.

---

## 7. Git Runtime implementation approach — RESOLVED (as a recommendation)

**Where:** `Runtime Capabilities` (Git Runtime namespace) — no implementation guidance existed

**Resolution (this pass):** `Agentide.md → Section 7 (Future Runtimes → Git Runtime
implementation notes)` recommends a native Git library (e.g. `isomorphic-git` or `libgit2`
bindings) over CLI shell-out, specifically because Runtime Capabilities' structured
input/output/error requirement is easier to satisfy with a library than by parsing CLI
stdout. Stated as a general convention for any future runtime wrapping an existing CLI tool,
not just Git.

Original finding, kept for reference: no doc specified *how* Git Runtime should be
implemented; this mattered because a CLI-wrapper approach fights the structured I/O
requirement that Runtime Capabilities imposes on every handler.

**Remaining follow-up:** this is a recommendation, not a hard requirement — actual
implementation is still up to whoever builds the plugin, per whichever ownership track it
lands on (#6).

---

## 8. Architectural Refinement V1 is ~65% duplicate content — RESOLVED

**Where:** `ARCHITECTURAL REFINEMENT V1` (whole doc)

**Resolution (this pass):** The ~6 novel notes have been promoted into their proper home
documents:
- #3/#4 (Capability/Runtime Manifest) → `Terminology.md`
- #5 (Control Plane/Data Plane split) → `Terminology.md` (as Control Plane/**Execution**
  Plane, resolving #9's naming conflict at the same time)
- #9/#10/#11 (Dashboard as first-class product, DevTools, VS Code extension) →
  `Agentide.md → Section 14`
- #20 (final ownership model) → `Agentide.md → Section 16`, newly added as its own section

`Architectural_Refinement_V1.md` has been rewritten as a status changelog — every one of its
original 20 notes is marked either **Superseded** (fully covered elsewhere, doc points to
where) or **Promoted** (novel content, doc points to its new home) — plus a closing
recommendation that future design ideas be proposed as direct edits to canonical docs rather
than accumulating in a new parallel notes file.

Original finding, kept for reference: of 20 numbered notes, ~13 duplicated content already
specified elsewhere; only ~6 carried genuinely new information, and that content was buried
in a "not required for MVP" scratch doc rather than surfaced in the docs people would actually
reference.

---

## 9. Control Plane terminology conflict: "Data Plane" vs. "Execution Plane" — RESOLVED

**Where:** `ARCHITECTURAL REFINEMENT V1` #5 vs. `Terminology`

**Resolution (this pass):** `Terminology.md` has been rewritten as the canonical source of
truth. "Execution Plane" is retained as the term covering all runtimes
(Browser/Backend/Docker/Git/File/etc.). "Data Plane" is marked as superseded terminology
directly inside the Control Plane entry, with a note explaining what it used to mean and why
it was retired, so a reader who encounters it in Architectural Refinement V1 isn't left
confused.

Original conflict, kept for reference:

- Refinement's "Data Plane" = executing capabilities, routing requests, returning responses
  (framed as part of the Gateway)
- Terminology's "Execution Plane" = Browser/Backend/Docker/File Runtime collectively (framed
  as the runtimes themselves, not a Gateway subcomponent)

**Remaining follow-up:** Architectural Refinement V1 itself (#5) still uses the old "Data
Plane" wording and should be corrected or marked superseded when that doc is revisited — see
item #8.

---

## Documents rewritten so far

- **Terminology.md** — full rewrite. Resolves #9. Adds Capability Types comparison table,
  Plugin Manifest / Capability Manifest entries (promoted from Architectural Refinement V1
  per #8), Developer Plugin entry, and inline flags on open items (#4, #5) so the doc itself
  points back to unresolved work instead of silently omitting it. *(Updated again to close
  #5 — Plugin Manager entry now points to Plugin_Marketplace.md.)*
- **Capability_System.md** — completed (previously cut off). Resolves #1. Now the canonical
  abstract capability definition: general 7-field structure, capability-type classification
  test, full lifecycle, cross-references out to Business/Platform/Runtime docs instead of
  duplicating their content. Surfaces #3 (permission tiering gap) inline.
- **Runtime_Capabilities.md** — resolves #3. Adds the read/act/destructive permission tiering
  convention with a full worked table across browser/docker/git/filesystem namespaces.
- **Platform_Capabilities.md** — resolves #4. Adds "Permission Ownership by Deployment Model"
  section covering self-hosted vs. hosted/SaaS permission boundaries. *(Updated again to close
  #5 — adds `marketplace.*` capability category.)*
- **Business_Capability.md** — light touch. Cross-references Capability System, notes it
  intentionally doesn't need permission tiering yet, flags it as a thing to watch as the
  catalog grows.
- **Goals.md** — resolves #2. Consolidates four agnosticism principles into one ("Agnostic by
  Design") with sub-layers; renumbers remaining principles; cross-links #3/#4 resolutions into
  the relevant existing principles (Security by Default, Scalability).
- **Agentide.md** — resolves #6, #7, absorbs promoted content per #8. Adds Section 16
  (Ownership Model), expands Dashboard (Section 14) with DevTools/VS Code detail, adds
  ownership-track framework for future runtimes and a Git Runtime implementation
  recommendation, adds Phase 9/10 roadmap placeholders, reflects Control Plane/Execution Plane
  terminology throughout. *(Updated again to close #5 — Phase 10 and Plugin Manager section
  now point to Plugin_Marketplace.md.)*
- **Architectural_Refinement_V1.md** — rewritten as a status changelog. Resolves #8. Every
  original note marked Superseded or Promoted with a pointer to its new home; closes with a
  recommendation against maintaining a parallel notes doc going forward.
- **Plugin_Marketplace.md** — new document. Resolves #5. Defines the registry, three trust
  tiers (Official/Verified/Community), publishing pipeline, `marketplace.*` Platform
  Capabilities, installation resolution, private-source installs, and deployment-model
  interaction. Leaves review SLA, revocation, monetization, and runtime sandboxing as
  explicitly out-of-scope follow-ups.

---

## Open questions carried forward (not yet resolved)

- **Tenant-scoped listing deferred from BI[6] to BI[14]** — see #11. `capability.list` and
  `plugin.list` filtering by caller's tenant requires a per-tenant model that doesn't exist
  yet. Punted from BI[6] PRD to BI[7] in BI[6]'s GRILL, then re-punted from BI[7] to BI[14]
  in BI[7]'s grill. BI[14] (Tenant design) doesn't exist on the backlog yet; it's an open
  item in `CONTEXT.md` under "Tenant design — multi-tenancy isolation semantics beyond the
  plugin-permission split above are not fully specified." A new backlog row should be created
  when this pack is scheduled.

- Which specific ownership track (core-team / community / customer-built) does each future
  runtime (Docker, Git, File, Kubernetes, Database) actually get assigned to? (follow-up to #6)
- Plugin Marketplace follow-ups explicitly flagged as out-of-scope in that document: review
  capacity/SLA for Verified tier, revocation handling for already-installed malicious plugins,
  monetization/licensing, and runtime sandboxing. (follow-up to #5)

## Resolved

#1, #2, #3, #4, #5, #6 (framework), #7 (as a recommendation), #8, #9 — all nine original
drift items. See corresponding sections above for resolution detail.

---

## 10. "Backend SDK" used as if it were a single package name — RESOLVED

**Where:** `Terminology` (SDK, Backend SDK, Frontend SDK entries) × `Agentide` (Section 6,
Phase 3, Phase 8) × `Feature_Backlog.md`

**Found this session**, while scoping the first `feature-pipeline` run. Docs listed "Backend
SDK" as a peer example alongside "Python SDK," "Go SDK," "Rust SDK" in Terminology, while
Agentide's roadmap used "Backend SDK (TypeScript)" for Phase 3 and "Additional SDKs — Go,
Python, Rust, Java, .NET" for Phase 8 — implying "Backend SDK" was simultaneously (a) the
name of one specific TypeScript package and (b) a category that Python/Go/Rust also belong
to. The actual npm/pip/cargo install examples compounded this: `@platform/backend-sdk`,
`platform-sdk` (pip), and `platform-sdk` (cargo) all used near-identical generic names with
no language marker, which would become genuinely ambiguous to talk about once more than one
existed.

**Resolution (this pass):**
- `Terminology.md → SDK` now states explicitly that "Backend SDK" and "Frontend SDK" are
  **roles**, not package names, and adds a per-language package table: `@platform/sdk-node`,
  `platform-sdk-python`, `platform-sdk-go`, `platform-sdk-rust`, `platform-sdk-java`,
  `platform-sdk-dotnet`, and `@platform/sdk-browser` for the Frontend role.
- `Terminology.md → Backend SDK / Frontend SDK` entries rewritten to reflect this — Frontend
  SDK explicitly noted as *not* needing per-language variants, since it's inherently browser
  JS/TS regardless of which frontend framework consumes it.
- `Agentide.md` Section 6, Phase 3, and Phase 8 updated to use the explicit package names
  throughout, rather than "(TypeScript)" and a bare language list.
- `Feature_Backlog.md` topic slugs renamed to match: `backend-sdk-typescript` → `sdk-node`,
  `frontend-sdk` → `sdk-browser`, `additional-language-sdks` → `additional-backend-sdks` with
  explicit per-language package names, and all downstream dependency references updated.

**Remaining follow-up:** none — this was fully mechanical once the naming convention was
picked. Future SDKs (if a "Kotlin SDK" or similar is ever added) should follow the same
`platform-sdk-<language>` pattern by default.

---

## 11. Tenant-scoped listing deferred from BI[6] to BI[14] — DEFERRED

**Where:** `docs/features/platform-capabilities/PRD-platform-capabilities.md` §Out of Scope
("Tenant-scoped plugin list — punted to BI[7] permission-tiering") × BI[7] grill Q4
(2026-07-28) × `CONTEXT.md` Open Items ("Tenant design — multi-tenancy isolation
semantics beyond the plugin-permission split above are not fully specified").

**Found this session**, while grilling BI[7] permission-tiering. The BI[6] PRD punted
"Tenant-scoped plugin list" to BI[7] assuming BI[7] would naturally own it. On closer
inspection during BI[7] grill, this is a structural punt waiting to happen:

- **Plugins are global** — `installed-plugins.json` lives at the platform root, not per-tenant.
  `InstallRecord` (`packages/plugin-manager/src/types.ts:53`) has no `tenantId` field.
- **Capabilities are global** — `CapabilityRecord` (`packages/capability-registry/src/types.ts:34`)
  has no `tenantId` field. Caps register with the Capability Registry at startup, not
  per-tenant.
- **Tenants** exist for `tenant.*` operations and token scoping (the `caller.tenantId` field
  on `TokenClaims`), but the install/capability layer is single-tenant-by-platform.

To "filter by tenant" we'd need a per-tenant model: per-tenant install records, per-tenant
capability visibility, possibly a tenant-internal `Capability Registry` namespace. That's
an architectural decision, not a feature delta.

**Resolution (this pass):**
- BI[7] desc narrowed to: "Tier field on CapabilityRecord + tier-aware capability.list +
  wildcard scope tests." The "tenant-scoped listing" surface is dropped from this pack.
- BI[7] still unblocks the Tier 3 packs (browser-runtime, docker-runtime) — those need tier
  enforcement, not tenant scoping.
- The original BI[6] punt is now a `DEFERRED` drift item, not silent. Path forward:
  - **BI[14] (Tenant design)** needs to be created on the backlog. It's currently an open
    item in `CONTEXT.md` only.
  - When BI[14] ships, it should produce the per-tenant model (install records scoped,
    capability visibility policy, tenant-scoped listing semantics).
  - BI[7] does NOT need to be re-opened — its tier-aware listing is tenant-agnostic by
    design. Adding tenant filtering on top of tier filtering is a multi-axis query that
    BI[14] owns.

**Punt trail (chronological):**
- 2026-07-28 — BI[6] GRILL, original punt: "Tenant-scoped plugin list — punted to BI[7]."
- 2026-07-28 — BI[7] grill Q4, re-punt: "Out of scope. Awaits BI[14] (Tenant design)."

**Remaining follow-up:** Create BI[14] on the backlog. Tag it as gating Tier 3-5 packs
that touch installation or capability visibility.

---

## #12 — Reconciled `simulate.ts` Step 4 banner should mention `GATEWAY_SESSION_REQUIRED`

**Discovery:** 2026-07-29 (BI[7] sub-agent drift check)

**What drifted:** The reconciled simulation's Step 4 invokes `gateway.handleInvocation`
without a session token. The real `handleInvocation` pipeline runs session-check
*before* scope-check, so the actual denial code is `GATEWAY_SESSION_REQUIRED`,
not `GATEWAY_INSUFFICIENT_SCOPE` (which PRD-TRD Scenario 2 anticipated assuming
a session was already present).

**Why this matters:** A future reader of the sim will see the unexpected error code
and wonder if the tier enforcement is broken. The sim itself handles both branches
correctly; only the banner copy is misleading.

**Resolution:** ACCEPTED drift. The sim step is illustrative. If someone wants to
demonstrate the scope-denial path, the next iteration of `simulate.ts` should call
`gateway.createSession()` first (or read the audit log to surface the right
denial). Logged here for future iteration.

**Refs:** docs/features/permission-tiering/simulate.ts Step 4

---

## #13 — `archive/simulate-pre.ts` retained (not deleted) per IMPL Phase 8

**Discovery:** 2026-07-29 (BI[7] sub-agent drift check)

**What drifted:** IMPL Phase 8 said: "Delete `simulate-pre.sh` / `.html` (or move to
`docs/features/<slug>/archive/`)". The implementation chose the archive option,
keeping the pre-impl simulation (953 lines, hardcoded catalog) as a reference
alongside the canonical reconciled `simulate.ts` (371 lines, real packages).

**Why this matters:** Future readers may not realize the archived sim still works
and shows the *design* vs the *reality* side-by-side. The skill's reconcile phase
explicitly archives rather than deletes to preserve this comparison.

**Resolution:** ACCEPTED drift. The archive/ folder is intentional per the
feature-pipeline skill. Documented here so the next agent doesn't accidentally
delete it as cruft.

**Refs:** docs/features/permission-tiering/{simulate.ts,archive/simulate-pre.ts}

---

## #14 — Gateway token refresh flow not implemented; SaaS-ready auth requires a separate pack

**Discovery:** 2026-07-29 (sdk-node GRILL session)

**What drifted / what's missing:** The Gateway mints JWTs with an `exp` claim via
`auth.token.issue`. There is no token-refresh endpoint, no refresh-token rotation,
no "extend session" path. An SDK holding a long-lived connection will silently go
unauthenticated after the token's `expiresInMs` (default 1 hour per the auth tests).
The architecture (`docs/architecture/Agentide.md` §9) describes a SaaS-ready Gateway
that uses JWTs for tenant + caller identification, so this gap blocks any SaaS
deployment.

**Why this matters:** Before sdk-node can be production-ready for a hosted SaaS
Gateway, the SDK needs either (a) a refresh-token flow the SDK calls before
expiry, (b) very long-lived tokens with server-side revocation, or (c) a websocket
keepalive that re-authenticates inline. None of these exist today.

**Resolution:** DEFERRED. The Gateway is architecturally SaaS-ready (token model,
tenant model, audit log, rate limiting, storage abstraction all support it) but
the refresh flow is a separate pack that needs its own GRILL — likely tied to the
dashboard-core or a future "gateway-saas" pack. Logged here so sdk-node v1 can
stay scoped to "localhost / on-prem / co-located" without claiming SaaS support.

**Refs:**
- `packages/gateway-core/src/auth.ts` (issueToken, no refresh)
- `docs/architecture/Agentide.md` §9 (JWT-based auth model)
- sdk-node GRILL session, this conversation
