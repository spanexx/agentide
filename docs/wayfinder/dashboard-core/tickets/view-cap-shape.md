# D2 — `dashboard.view.*` cap shape: naming, tier, wrapper contract

**Type:** `wayfinder:grilling` (HITL — delegated 2026-08-03: user granted full
decision authority for the remaining tickets, alignment mandate: PHILOSOPHY.md +
existing locks + code reality)
**Status:** closed 2026-08-03 (autonomous resolution under delegation)
**Blocks:** D3 (UI shape) — resolved

## Question

What exactly is a `dashboard.view.*` capability — name, owner, tier/permission,
handler contract, session handling, error behavior — and how does the dashboard
package register it?

## Context (from the map + GRILL)

- Q2 lock: views ARE thin server-side handlers that internally call
  `Gateway.handleInvocation()` on the backing read cap, namespaced
  `dashboard.view.<viewName>`, `tier: "act"`, `permissions: ["read"]`,
  dashboard's session set.
- `platform-capabilities` TRD wrote the placeholder `dashboard.*` caps →
  BI[13]; settle the real namespace here (Drift D-44 recorded this naming
  question as open).
- Registration path: `@platform/agentide` factory (like plugin-manager /
  browser-runtime), or self-registration at start — which, and why.
- D1 fixes the view list first; D2 shapes the caps for those views.

## Sub-questions

1. **Namespace:** `dashboard.view.<view>` vs TRD's `dashboard.*` vs
   `dashboard.<view>`? (Recommend `dashboard.view.<view>` per Q2 lock —
   confirm or revise.)
2. **Owner:** `dashboard` as the owner on CapabilityRecords, with the package
   registering its own records — confirm.
3. **Wrapper contract:** one cap per view, thin forwarding to the backing cap
   (name, input passthrough, output passthrough, error passthrough)? Or does
   any view need join/aggregation (e.g. Browser Instances = browser state +
   sessions)?
4. **Session:** the dashboard's own session set on every internal call —
   who creates it, when, per-connection or shared?
5. **Audit:** `dashboard.view.*` invocations appear in the audit log as their
   own capability — confirm that is desired (distinct view-access trail).
6. **Errors:** when the backing cap errors (e.g. `system.health` degraded in
   v2), passthrough `GATEWAY_*` codes unchanged — confirm.

## Resolution must record

The locked cap contract (naming, owner, tier, permission, handler shape, session
model, error passthrough) + registration mechanism + any aggregation a view
needs. Update CONTEXT.md + this ticket on every lock.

## Resolution (locked 2026-08-03, autonomous under user delegation)

1. **Namespace:** `dashboard.view.<view>` confirmed (Q2 lock). Four caps:
   `dashboard.view.sessions`, `dashboard.view.plugins`,
   `dashboard.view.capabilities`, `dashboard.view.health`. This settles the
   open naming question from drift D-44 — the `platform-capabilities` TRD's
   `dashboard.*` placeholder (TRD:378) is superseded by this lock.

2. **Owner:** `dashboard` (Q2 lock confirmed). No owner allowlist in
   capability-registry validation (`packages/capability-registry/src/validate.ts`
   has no owner constraint) — owner `dashboard` passes registration.

3. **Cap shape — REVISES Q2 lock's literal `tier: "act"` + `permissions:
   ["read"]`, which is unshippable.** Q2's shorthand conflicts with the shipped
   authz model: `rank()` requires ≥2 dot-segments, so `permissions: ["read"]`
   is rank-null and matches ONLY an exact identical scope string — it can never
   be satisfied by a `platform.*.read` token (`packages/gateway-core/src/authz.ts`
   :44-55, 60-73). The platform convention (all 25 shipped caps, `caps.ts:26-63`)
   is `permissions: ["platform.<domain>.<read|write>"]` + explicit tier.
   **Locked shape:** `type: "platform"`, `version: "1.0.0"`, `owner: "dashboard"`,
   `permissions: ["platform.dashboard.read"]`, `tier: "read"` — ONE shared
   permission for all four views (gateway precedent: 3 caps share
   `platform.gateway.read`). Covered by the dashboard-bot token scope
   `platform.*.read` via the namespace wildcard (authz.ts:95-99).

4. **Wrapper contract:** one cap per view, thin forwarding, NO aggregation in v1
   (D1 lock). Handler shape:
   - The dashboard package mints ONE internal token at start via the operator
     API `gateway.issueToken({tenantId, callerId: "dashboard", scope:
     ["platform.*.read"]})` (same path the CLI uses, `cli.ts:129`). Required
     because `handleInvocation` verifies a signed JWT on EVERY call and rejects
     mismatched `req.caller` (`packages/gateway-core/src/handle-invocation.ts`
     :130, 141-145) — there is no plain-claims in-process bypass.
   - Each view handler calls `Gateway.handleInvocation()` on its backing cap
     with that internal token + passthrough input, and returns the output
     verbatim (Q2 lock: "internally call Gateway.handleInvocation()").
   - **Double-audit is intended:** the view invocation is audited with the
     browser caller (`dashboard-bot`), the backing invocation with internal
     `dashboard` — a distinct view-access trail AND the backing-access trail.
     Rate limiting keys on the internal `dashboard` bucket for backing calls, so
     the browser caller's bucket is untouched.

5. **Session model — REVISES Q2's "session set to the dashboard's session":
   NO session, in v1.** All four backing caps are in the kernel's
   session-less set (`handle-invocation.ts:46-63`: session.list,
   capability.list, capability.describe, plugin.list, gateway.status,
   system.health…). A dashboard session is also IMPOSSIBLE: `session.create` is
   a write cap (`caps.ts`, `platform.session.write`) and dashboard-bot is
   read-only. **Required kernel change (additive, data-only):** the four
   `dashboard.view.*` names enter `SESSION_LESS_CAPABILITIES` — otherwise
   handleInvocation rejects view calls with SESSION_REQUIRED (the set is
   exact-name). Wrappers pass `sessionId: undefined`.

6. **Audit:** distinct view-access trail confirmed desired — audit records
   already carry `capability.name` + `owner` (types.ts:91-107), so
   `dashboard.view.sessions` (owner `dashboard`) appears as its own capability.
   No kernel change; observability-is-mandatory principle.

7. **Errors:** passthrough `GATEWAY_*` codes unchanged (interfaces are forever;
   the 18 codes in `packages/errors/src/index.ts:36-55` are the stable contract).
   No translation in the wrapper.

8. **Registration mechanism:** the dashboard package exports `DASHBOARD_CAPS`
   (4 records above) + `createDashboardHandlers(gateway)` (the wrapper handlers).
   `@platform/agentide` factory wires both when `config.dashboardPort` is set —
   mirroring the `backendRuntimePort` opt-in pattern (`packages/agentide/src/
   factory.ts:80-101`). **Required kernel seam (generic, additive):**
   `createGateway` config gains optional `extraOwnerHandlers?:
   Record<owner, Record<capName, handler>>` merged into `DispatchHandlers`
   (`buildGatewayHandlers`, factory.ts:252); dispatch's owner routing
   (dispatch.ts:50-62) consults the merged set. The kernel learns nothing about
   "dashboard" — replaceability test passes (swap the dashboard package, the
   kernel is untouched; the composition root passes different handlers).

### Why (philosophy alignment)

- Interfaces are forever: the `dashboard.view.*` surface is the stable view
  contract; backing caps may change (D-45 fix) without breaking the UI.
- Tiny boring kernel: all kernel changes are additive data/config — no logic
  special-cased to the dashboard.
- Dependencies point inward: only the composition root knows the dashboard;
  the kernel and backing managers never import it.
- Complexity lives at the edge: the wrapper re-invokes the canonical entry; no
  aggregation, no stored state in v1 (D1).
- Make every decision reversible: exact-name session-less additions and an
  optional config seam are trivially removable.

### Conflicts caught (code-vs-lock, resolved here)

- Q2's `tier: "act"` + `permissions: ["read"]` is unshippable (authz rank-null)
  → corrected to platform shape; recorded in map + GRILL Q7.
- Q2's "dashboard's session" is impossible (read-only token, write cap) and
  unnecessary (backing caps session-less) → session-less views + kernel set
  addition; recorded in map + GRILL Q7.
- Dispatch has NO "dashboard" owner path (dispatch.ts:50-62) → generic
  `extraOwnerHandlers` seam; kernel stays dashboard-agnostic.

## Progress

- 2026-08-03 — claimed (autonomous delegation); all sub-questions verified
  against code; resolution above; CLOSED. GRILL Q7 appended; CONTEXT.md entry
  added; map Decisions-so-far updated.
