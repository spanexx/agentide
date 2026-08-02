# Future: sdk-node — what's NOT in v1, and what comes after

`@platform/sdk-node` v1 ships the minimum needed to unblock `mcp-adapter` (#9):
an app can connect, register capabilities, and the Gateway can invoke them.
Everything below is intentionally deferred.

This file is the single source of truth for "what v2 / v3 / etc. look like."
Each section has a trigger — the event that would make us need it — and a
brief sketch of the API change.

---

## v2 — Production polish

Trigger: A real app uses v1 in production and needs more than survival.

### v2.1 — Token refresh flow
Drift log: #14

**Why:** Gateway mints JWTs with `exp` but has no refresh endpoint. SDK connections go silent after `expiresInMs`. Blocks SaaS deploys.

**Sketch:**
- New Gateway capability: `auth.token.refresh` — accepts a valid (but expiring) token + refresh secret, returns a new token.
- SDK: when `expiresInMs - now < threshold`, transparently call `auth.token.refresh`. Retry any in-flight invocations that landed in the gap.
- `connect()` config gains `tokenRefreshThresholdMs` (default 5 min).

### v2.2 — Schema validation
**Why:** Manifest declares `inputSchema` / `outputSchema` but v1 doesn't enforce them. Bad input causes silent handler failures.

**Sketch:**
- SDK validates every incoming input against the registered inputSchema before dispatching.
- Validates handler return value against outputSchema before returning to Gateway.
- Use Ajv (or similar) under the hood; tree-shakeable so apps that don't declare schemas don't pay.

### v2.3 — Observability hooks
**Why:** v1 emits bus events but app developers want their own metrics / traces / logs at the SDK boundary.

**Sketch:**
- `connect({ observability: { metrics, tracer, logger } })` — pluggable sinks.
- SDK emits OpenTelemetry spans around connect, register, invoke.
- Metrics: counter `sdk.invocations.{ok,error}`, histogram `sdk.invoke.duration_ms`.

### v2.4 — Multi-app per process
**Why:** Some apps want to expose multiple logical apps from one Node process (microservices sharing a runtime).

**Sketch:**
- `createSdk()` returns a single connection. For multi-app, expose `createSdkPool({ connections: [...] })`.
- Each app has its own manifest, handlers, registration lifecycle.
- One WebSocket connection multiplexes; events tagged with `app.id`.

---

## v3 — Alternate runtimes (Q7-C design, deferred)

Trigger: A customer needs Lambda / edge / Cloudflare Workers / Deno / Bun / etc.

### v3.1 — Lambda runtime
**Why:** Most serverless deploys use Lambda. Same shape, different lifecycle.

**Sketch:**
- Handler exports single async function `handler(event, context)`.
- SDK wraps AWS Lambda runtime; each cold start = new connect + register.
- Warm invocations reuse the connection (SDK keeps a per-process connection pool).

### v3.2 — Edge runtime (Cloudflare Workers / Deno Deploy)
**Why:** Edge functions can't hold long-lived WebSockets; lifecycle is per-request.

**Sketch:**
- Handler exports `fetch(request)`; SDK uses request/response, not events.
- Reconnect is per-request, not persistent. No auto-reconnect needed (no socket to drop).

### v3.3 — Worker pool
**Why:** Apps want handler execution off the main Node process (CPU isolation, separate failure domain).

**Sketch:**
- `connect({ runtime: { type: 'worker', exec: 'node worker.js' } })` spawns a child process.
- Handlers loaded in worker; SDK keeps a pool of N workers; round-robins.
- Worker crash → SDK restarts the worker; in-flight invocations fail-fast and the caller retries.

---

## v4 — Platform extensions

Trigger: Architectural needs beyond what v1-v3 cover.

### v4.1 — App-side subscriptions (Q6-A flipped to B)
**Why:** Some apps want to react to platform events about their own capabilities (tier changes, deprecation warnings, marketplace updates).

**Sketch:**
- `sdk.subscribe('capability.*.tier.changed', handler)` scoped to this app's capabilities only.
- Subscription requires a separate scope grant; can't be done with the connect() token.
- Per-tenant filtering on subscriptions.

### v4.2 — Capability deprecation flow
**Why:** Apps evolve. Old capability names get renamed; the SDK should help clients migrate.

**Sketch:**
- Manifest declares `supersedes: ['old.capability.name']`.
- SDK auto-registers both during a deprecation window; emits `sdk.capability.deprecated` event.
- App can opt-in to "alias" mode where old names keep working until callers migrate.

### v4.3 — Marketplace integration
**Why:** Apps may want to publish their manifest to the marketplace from the SDK side.

**Sketch:**
- `sdk.publish({ manifestPath })` sends to the marketplace pack (#16).
- Requires marketplace scope on the token.
- v4 not before the marketplace pack itself is shipped and stable.

---

## v5 — Out of scope forever

These aren't planned at any version. If they come up, they get their own pack.

- **Auth identity model** — who is the developer? SaaS portal? Customer? Org? — that GRILL belongs to a "gateway-saas" pack, not sdk-node.
- **Capability runtime execution** — sdk-node invokes handlers in-process. Where the code runs (Lambda, edge, k8s) is the deployer's choice, not the SDK's. The runtime adapters (v3.x) handle distribution.
- **Billing / metering** — Gateway counts invocations, billing is a separate concern. Logged separately.

---

## Open questions for each future version

- v2.1: Refresh secret rotation? Single-use vs reusable refresh tokens? — open
- v2.2: Should schema validation be opt-in or default-on? — open
- v2.3: OTel default yes or opt-in? — open
- v3.1: Cold-start latency budget? — depends on v2.3 metrics
- v4.1: Per-tenant vs per-app subscription scope? — depends on marketplace pack

Each v2.x / v3.x ships only when a real app needs it. v1 is the contract;
everything else is an extension.

---

## Related drift log entries

- #14 — token refresh flow (v2.1)