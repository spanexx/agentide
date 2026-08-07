# IMPL: REST adapter

**Slug:** rest-adapter
**Status:** In progress
**Date:** 2026-08-07

## Phase Plan

### Phase 1: package skeleton — ✅ Done (2026-08-07)

**Build:**
- `packages/adapter-rest/package.json` — name `@spanexx/adapter-rest`, deps:
  `@spanexx/gateway-core`, `@spanexx/adapter-core`, `@spanexx/errors`, `@spanexx/event-bus`.
- `packages/adapter-rest/tsconfig.json` — extends repo base.
- `packages/adapter-rest/src/index.ts` — public exports: `createRestAdapter`, `RestAdapterConfig`.
- `packages/adapter-rest/src/types.ts` — door-local types (`RestAdapterConfig`, `StatusMapEntry`).
- Wire into root `pnpm-workspace.yaml` (no change needed — `packages/*` glob already covers it).
- Wire into `packages/agentide/src/factory.ts:214-234` (alongside WS + MCP), default `adapterRestPort: 7400`.
- Add `adapterRestPort?: number` to `CreatePlatformConfig` (`packages/agentide/src/types.ts`).

**Verify:**
- [x] `pnpm install` clean
- [x] `pnpm typecheck` clean
- [x] `pnpm --filter @spanexx/adapter-rest build` produces dist

**Blocked by:** nothing.

### Phase 2: status map + createErrorConverter — ✅ Done (2026-08-07)

**Build:**
- `packages/adapter-rest/src/errors.ts` — the locked Q4 status map table per
  PRD-TRD §"API Contracts" + `createErrorConverter` from adapter-core wired with that table.
- `packages/adapter-rest/src/__tests__/status-map.test.ts` — every entry from the table
  renders the expected HTTP status; the verbatim body shape stays `{code, message, details, retryable}`.

**Verify:**
- [x] `pnpm --filter @spanexx/adapter-rest test` — status map table tests green.
  *(Note: per-package `vitest run` is broken repo-wide — the root config's include
  globs resolve relative to cwd, and vitest from a package subdir can't find
  them. The same failure happens for every package's `pnpm --filter X test`,
  not Phase 2's. Tests pass under `npx vitest run packages/adapter-rest/...`
  from root — 11/11 green.)*
- [x] No WS or MCP code paths touched (zero drift on those packages —
  `git diff --stat packages/adapter-{websocket,mcp}/src` empty).

**Blocked by:** Phase 1.

### Phase 3: bearer extraction + POST /invoke — ✅ Done (2026-08-07)

**Build:**
- `packages/adapter-rest/src/auth.ts` — `extractBearer(authHeader: string): string` modeled
  on `packages/adapter-mcp/src/server.ts:44-48` (case-insensitive `^Bearer\s+(.+)$`).
- `packages/adapter-rest/src/invoke.ts` — `handleInvoke(req, res, gateway, errors?)`:
  parses body to `PipelineInvocation`, calls `createAdapterPipeline({gateway, errors, response}).invoke(...)`,
  renders the channel's `end()` result as JSON with the locked status map. (5th param
  in the IMPL draft was a description slip — `channel` is the ResponseChannel created
  inside the pipeline; the handler signature is 4 params, `errors` defaults to
  `restErrorConverter`.)
- `packages/adapter-rest/src/__tests__/invoke.test.ts` — every PRD-TRD scenario 1–7, 9, 10
  hits this handler with a fake gateway + fake response stream.

**Verify:**
- [x] `pnpm --filter @spanexx/adapter-rest test` — invoke handler tests green.
  *(Same per-package test quirk as Phase 2 — `npx vitest run packages/adapter-rest`
  from root, 17/17 green.)*
- [x] Body shape: `JSON.stringify({code, message, details, retryable})` byte-for-byte verbatim
  (Scenario 10 reference payload test asserts the exact wire string).

**Blocked by:** Phase 2.

### Phase 4: GET /capabilities — ✅ Done (2026-08-07)

**Build:**
- `packages/adapter-rest/src/capabilities.ts` — `handleGetCapabilities(req, res, gateway, errors?)`:
  calls `createCapabilityLookup.list(token)` from adapter-core (the lookup is created
  inside the handler with `{gateway, errors}`), returns `{capabilities: [...]}`.
  Bearer missing → 401 TOKEN_INVALID (door-fabricated); lookup errors render via
  the locked Q4 status map (cast at the door boundary — the shared
  `LookupOutcome` type exposes only `{code, message}` while `restErrorConverter`
  returns a `RestErrorPayload` with status at runtime).
- `packages/adapter-rest/src/__tests__/capabilities.test.ts` — list returns cards;
  missing token → 401; insufficient scope → 403; runtime error → 500; empty-scope
  token defensive `[]`; bearer forwarded verbatim.

**Verify:**
- [x] `pnpm --filter @spanexx/adapter-rest test` — capabilities handler tests green.
  *(Same per-package test quirk as Phase 2/3 — `npx vitest run packages/adapter-rest`
  from root, 7/7 green.)*
- [x] `GET /capabilities/{name}` route is **NOT** registered (deferred per D-100) —
  the handler only resolves `/capabilities` exactly; the router is wired in
  Phase 5, and the `{name}` path will deliberately 404.

**Blocked by:** Phase 3.

### Phase 5: HTTP server + router — ✅ Done (2026-08-07)

**Build:**
- `packages/adapter-rest/src/server.ts` — `createRestAdapter(gateway, config)` returns
  `Adapter`-shaped `{name, start, stop}`. Uses `node:http` (no framework). Router:
  - `POST /invoke` → Phase 3 handler
  - `GET /capabilities` → Phase 4 handler
  - any other → 404 with `INVALID_REQUEST` body (IMPL Phase 5 spec: 404 status with the
    error envelope; locked Q4 table maps `INVALID_REQUEST` to 400 for kernel errors —
    this 404 is a door-routing decision, not a table lookup).
  - `GET /capabilities/{name}` is intentionally NOT routed (D-100 deferral).
- `packages/adapter-rest/src/__tests__/server.test.ts` — boots the server on a free
  port (`port: 0`), drives the 10 PRD-TRD scenarios end-to-end with `fetch` (Node 22
  stdlib), asserts on HTTP status + body JSON shape + content-type header.

**Verify:**
- [x] `pnpm --filter @spanexx/adapter-rest test` — server tests green.
  *(Same per-package test quirk; 17/17 green via `npx vitest run
  packages/adapter-rest/src/__tests__/server.test.ts` from root.)*
- [x] `pnpm typecheck` clean + `pnpm lint` clean.

**Blocked by:** Phase 4.

### Phase 6: factory wiring + sim — ✅ Done (2026-08-07)

**Build:**
- `packages/agentide/src/factory.ts:242-256` — wire `createRestAdapter` when
  `config.adapterRestPort !== undefined` (done in Phase 1, locked here):
  `if (config.adapterRestPort !== undefined) { restAdapter = createRestAdapter(gateway, {...}); await restAdapter.start(); }`.
  Stop joins `platform.stop()`; the handle is exposed on `Platform.restAdapter`.
- `docs/features/rest-adapter/simulate-server.mjs` — Node helper that boots the
  REAL `createRestAdapter` on 127.0.0.1 (default port 7400) with a deterministic
  fake gateway so the bash sim can drive all 10 PRD scenarios via curl. Test
  tokens are real-shape JWTs (base64url-encoded payload) so the lookup's
  `readClaims(token).scope` reads a real scope.
- `docs/features/rest-adapter/simulate.sh` — bash orchestration: verifies port
  7400 is free at boot, builds `adapter-rest/dist/`, boots the helper in the
  background, drives the 10 PRD-TRD scenarios + 2 routing sanity checks via curl,
  tears down the helper, prints a PASS/FAIL tally. Exits 0 on all-pass.

**Verify:**
- [x] `bash docs/features/rest-adapter/simulate.sh` exits 0 — 16/16 pass
  (10 PRD scenarios + 2 routing checks + 4 setup checks: build, port-free,
  helper-ready, teardown).
- [x] Loopback-only (127.0.0.1), port 7400 free at boot — verified by `ss -ltn`
  pre-flight; helper binds only to 127.0.0.1.
- [x] `pnpm test` full repo green — 1094 passing, 1 pre-existing failure
  (`packages/agentide/src/__tests__/release-yml.test.ts:release.yml publish
  workflow (post-drop-cjs-siblings)` CID:release-yml-005 — expects 15 packages
  in `release.yml`'s publish filter, the workflow has 16 since D-99; stale
  test, NOT introduced by the REST adapter pack). No regression to WS / MCP /
  dashboard.

**Blocked by:** Phase 5.

## Phase Dependencies

```
Phase 1 (skeleton)  ──> Phase 2 (status map)  ──> Phase 3 (invoke)  ──> Phase 4 (capabilities)  ──> Phase 5 (server)  ──> Phase 6 (factory + sim)
```

Linear. Each phase is green-at-each-step (matches the A7 / A8 precedent).

## Test Strategy

- **Unit tests** in `packages/adapter-rest/src/__tests__/`:
  - `parse.test.ts` — body parser, bearer extraction.
  - `router.test.ts` — request routing by method + path.
  - `status-map.test.ts` — every entry from the locked table renders the expected status.
  - `invoke.test.ts` — POST /invoke handler with a fake gateway.
  - `capabilities.test.ts` — GET /capabilities handler.
  - `server.test.ts` — full server boot on a free port.
- **Post-impl sim** at `docs/features/rest-adapter/simulate.sh` — drives a real `createRestAdapter`
  + `createPlatform({adapterRestPort: 7400})`, walks the 10 PRD-TRD scenarios via `curl`.
- **Cross-pack gate** — `pnpm test` full repo green (no regression to WS / MCP / dashboard).

## Dependency Analysis (opensrc)

**No new external deps.** The door uses Node 22 stdlib: `node:http` for the server,
`node:url` for parsing, `node:querystring` if needed for future POST body form parsing
(no requirement in v1). HTTP parsing is small enough that pulling in a framework
(Express, Fastify, Koa) would inflate the door's surface for zero architectural gain.
Precedent: `packages/dashboard-core/src/server.ts` does exactly this.

## Rollout

- **Ship as a feature pack** alongside the rest of the adapter family. The pack lives
  at `packages/adapter-rest/` and is published as `@spanexx/adapter-rest` via the existing
  release-please pipeline (matches `@spanexx/adapter-websocket` and `@spanexx/adapter-mcp`).
- **No migration** — new door, no existing behavior to replace. Per the A9 ticket: the
  zero-delta rule does **not** apply.
- **Flag:** `createPlatform({adapterRestPort: 7400})` enables the server. Default off
  (zero behavior change for existing operators).
- **CLI flag** (mirrors `--dashboard-port`): add `--adapter-rest-port <n>` to
  `packages/agentide/src/cli.ts` + `start.ts` (Phase 7/stretched if shipped; not in v1 scope).

## Risk Notes

- **D-100** — `createCapabilityLookup.describe()` is broken against the real kernel. Resolves
  before `GET /capabilities/{name}` ships (currently deferred to v1.1). If the fix lands
  during this pack, it can be tucked into Phase 4 as a one-liner.
- **A8 lazy-auth dependency** — A9's auth story assumes A8's lazy auth path lands. If A8's
  pack ships without that step, REST still works: kernel `verifyToken` runs per call
  (`handle-invocation.ts:145`), the door just passes the token through. The locked Q2
  contract holds under both flows.
- **Precommit blocker** — the parallel A8 work in the working tree has a banned `unknown`
  type in `packages/adapter-mcp/src/translate.ts:140`. Stash the parallel A8 work (or
  wait for it to land) before any commit. Per AGENTS.md rule -1, do not touch it.
- **Port conflict** — 7400 confirmed unallocated by A9-R1 §11. If a future adapter ships
  on 7400, the wiring point's `adapterRestPort` config knob is the override.
- **No client_credentials in v1** — if a real machine-identity consumer lands before
  v1.1, the kernel `gateway.oauthTokenHandler` is reachable; wire it in via a one-line
  serve on a `/oauth/token` route (mirrors `adapter-mcp/src/server.ts:117-120`).
