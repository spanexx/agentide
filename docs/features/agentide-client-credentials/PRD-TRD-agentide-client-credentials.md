---
slug: agentide-client-credentials
status: Approved (PRD)
date: 2026-08-05
audience: protocol/contract

# PRD-TRD — agentide-client-credentials

> **For Hermes:** the IMPL below is the source of truth for code structure.
> CID-indexed. Tests must mirror the scenarios.

> **Note:** supersedes the operator's manual JWT minting + paste-into-`.env`
> flow. replaces it with a one-time-per-app client credential that the SDK
> auto-refreshes. legacy `PLATFORM_TOKEN` static path stays in place.

**Goal:** replace per-call manual JWT minting + paste-into-`.env` with a one-time-per-app client credential. The SDK auto-refreshes short-lived JWTs. The operator runs one CLI command per app lifetime; everything else is automatic.

**Architecture:** OAuth2-style `client_credentials` grant on the gateway. Operator mints `client_id + client_secret` once. SDK uses them at `POST /oauth/token` to receive short-lived JWT, refreshes ~1 min before expiry. A separate registration-code flow lets the operator be offline.

**Tech Stack:** TypeScript, esbuild bundling, pnpm workspaces, vitest. No new runtime dependencies.

---

## Scope

**Owned by this pack:**
- `ClientRecord`, `RegistrationCode`, `ClientStore` types and persistence
- `ClientService` (create, verify, revoke, rotate, registration-code, redeem)
- `POST /oauth/token` HTTP endpoint (client_credentials grant)
- `POST /oauth/authorize` + `GET /oauth/callback` (OIDC auth-code grant, gated by `--enable-oidc`)
- `agentide client {create, grant, list, revoke, rotate, redeem}` CLI commands
- SDK auto-refresh in `@spanexx/sdk-node`
- New `GatewayConfig.requireTls` + `--no-tls` flag

**Not in scope (deferred):**
- A real IdP integration (auth-code production swap is a 5-line change)
- Distributed rate limits (in-memory bucket per process; per-instance only)
- Client-IP allowlisting (would block token endpoint from legit clients)
- Token audit metric dashboards (audit log rows are enough for v1)

---

## Scenarios

### Scenario 1: Operator creates a client

**Given** the operator has a working `agentide` install + a bootstrapped data dir
**When** they run `agentide client create --tenant acme --name nest-app --scope 'product.*'`
**Then** the gateway writes a `ClientRecord` to `clients.json` with `id=cli_<random>`, `hashedSecret=sha256(salt+secret)`, `defaultScope=['product.*']`, `revoked=false`, `createdAt=<now UTC>`. The plaintext secret is written to `<data-dir>/clients/.secret-<id>.txt` with mode `0600`. The CLI prints only the path. Exit 0.
- **WARNING:** the operator then `cat`s the file content into the nest app's `.env` and deletes the file from their downloads folder.
- **audit log row:** `{action: "client.create", client_id: "cli_xxx", tenant_id: "acme", actor: "operator", timestamp_utc: "2026-08-05T..."}`
- **rate-limit:** 5 creates per operator per hour → 6th create returns 429 with `{error: "rate_limited"}`.

### Scenario 2: SDK mints a token via client_credentials

**Given** a consumer app with `clientId=cli_xxx` + `clientSecret=<plaintext>` in its env
**When** the SDK starts up
**Then** it sends `POST /oauth/token` with `grant_type=client_credentials&client_id=cli_xxx&client_secret=<plaintext>` and receives `{access_token: "eyJ...", token_type: "Bearer", expires_in: 3600}`. The SDK stores the JWT and connects via the existing WebSocket. Exit (success) on the SDK side.
- The token's `sub` is `{tenantId: "acme", callerId: "cli_xxx"}` (the client id, not the app name).
- The token's `scope` is the client's `defaultScope: ['product.*']`.

### Scenario 3: SDK refreshes the token before expiry

**Given** the SDK has a JWT that expires in < 60s
**When** the SDK's next refresh tick fires
**Then** it sends `POST /oauth/token` again with the same client credentials and replaces the JWT. Refresh jitter: `Math.random() * 30_000` ms added so 1000 clients don't all refresh at the same wall-clock minute.
- **Tombstoning:** only one refresh in-flight at a time per client (avoid thundering herd if multiple timers race).

### Scenario 4: Operator revokes a client

**Given** the operator has a client `cli_xxx` minted earlier
**When** they run `agentide client revoke --client-id cli_xxx`
**Then** the gateway flips `revoked=true` on the record. The next `POST /oauth/token` returns 401 `{error: "client_revoked"}`. The SDK's refresh attempt fails; the SDK closes the WebSocket cleanly, emits a clear log line "client revoked; reconnect blocked", and stops reconnecting. Exit 0 on the CLI side.
- **Active token enforcement:** if a client with a valid JWT invokes anything after revoke, the gateway checks `revoked` on the current `ClientRecord` (loaded fresh from disk) and returns 401 with `error: "client_revoked"`. **No wait for the SDK refresh timer.**

### Scenario 5: Operator rotates a client secret

**Given** the operator has a client `cli_xxx` with a long-lived secret
**When** they run `agentide client rotate --client-id cli_xxx`
**Then** the gateway issues a new secret, writes the new secret to `<data-dir>/clients/.secret-<id>.txt.<new>`, leaves the old valid for 5 minutes (`gracePeriodEndsAt: now + 300_000`), and emits a rotate audit row. Exit 0.
- The operator updates the app's `.env` with the new secret. Within 5 min, the app connects with the new secret. The old secret works for the 5 min grace + is rejected after.
- **Cleanup:** after `gracePeriodEndsAt`, the old secret file is deleted (on next access).

### Scenario 6: Operator uses registration-code flow (offline-friendly)

**Given** the operator doesn't want to generate a secret and paste it manually
**When** they run `agentide client grant --tenant acme --name nest-app --scope 'product.*'`
**Then** the gateway writes a `RegistrationCode` to `registration-codes.json` with `code=rc_<random>`, `tenantId=acme`, `defaultScope=['product.*']`, `expiresAt=now+300_000`. The CLI prints the code + expiry. Exit 0.
- The operator sends the code to the app via Slack / email / save-on-disk.
- The app on first boot: `agentide client redeem --code rc_xxx` (or the SDK's equivalent) which POSTs to `/oauth/token` with `grant_type=registration_code&code=rc_xxx` and receives `{client_id, client_secret}`. The app saves these to its config.toml.
- **One-time use:** the code is marked `consumed=true` after the first successful redeem. Subsequent attempts → 401.

### Scenario 7: OIDC auth-code grant (humans)

**Given** the operator passed `--enable-oidc` when starting the gateway
**When** a user (or agent acting on a user's behalf) visits `POST /oauth/authorize?client_id=cli_xxx&redirect_uri=...&scope=...&response_type=code`
**Then** the gateway returns a 302 redirect to the dev-stub approval page (an HTML form with a "yes" button that POSTs to `/oauth/callback`). The user clicks yes → the callback redirects to `redirect_uri?code=...` → the SDK exchanges the code at `GET /oauth/callback` for a JWT.
- **production swap-in:** replace the dev stub with a redirect to a real IdP (Auth0, Keycloak, etc.). The 5-line change is in `oauth-token-handler.ts:handleAuthorize`.
- **when `--enable-oidc=false`:** `/oauth/authorize` returns 403. The CLI default is off because most operators don't have an IdP yet.

### Scenario 8: TLS enforcement

**Given** the gateway was started with `--require-tls` (default true)
**When** a client sends `POST /oauth/token` over plain HTTP
**Then** the handler returns 426 Upgrade Required with `{error: "tls_required", error_description: "POST /oauth/token requires TLS; use --no-tls only for localhost dev"}`.
- **When `--no-tls` is set:** plain HTTP works. Production should never set this flag.
- **Test:** `oauth-token-handler.test.ts` includes "tls required → 426" + "tls skipped → 200" cases.

### Scenario 9: Rate-limit on /oauth/token (brute-force defense)

**Given** a client exists with `client_id=cli_xxx`
**When** 11 requests in 60 seconds hit `/oauth/token` (success or failure) for that client_id
**Then** the 11th request returns 429 with `{error: "rate_limited", error_description: "10 req/min per clientId; retry after 60s"}`. The 1st through 10th succeed (or fail normally with the appropriate error).
- **Implementation:** in-memory `Map<clientId, { count, windowStart }>`. windowStart resets on `count > 10` and `now - windowStart > 60_000`.

### Scenario 10: Backward compatibility (legacy `PLATFORM_TOKEN`)

**Given** a consumer app with `PLATFORM_TOKEN=eyJ...` in its env (no `PLATFORM_CLIENT_ID` / `PLATFORM_CLIENT_SECRET`)
**When** the SDK starts up
**Then** it uses the static JWT directly. No `/oauth/token` call. No refresh. The token expires when its `exp` says so (the SDK doesn't extend it).
- **Migration:** apps can set both `PLATFORM_TOKEN` and `PLATFORM_CLIENT_ID` + `PLATFORM_CLIENT_SECRET`. The SDK prefers client_credentials if both are present. Operator can roll over file-by-file.

---

## Wire contract

### `POST /oauth/token`

**Request body** (form-encoded or JSON):
```
grant_type=client_credentials
client_id=cli_xxx
client_secret=<plaintext>
scope=<optional, overrides client's defaultScope>
```

or

```
grant_type=registration_code
code=rc_xxx
```

**Response 200**:
```json
{
  "access_token": "eyJ...",
  "token_type": "Bearer",
  "expires_in": 3600
}
```

**Response 400** (unsupported grant_type):
```json
{ "error": "unsupported_grant_type", "error_description": "only 'client_credentials' and 'registration_code' are supported" }
```

**Response 401** (bad credentials):
```json
{ "error": "invalid_client", "error_description": "client_id or client_secret invalid" }
```

**Response 401** (revoked):
```json
{ "error": "client_revoked", "error_description": "operator revoked this client" }
```

**Response 426** (no TLS):
```json
{ "error": "tls_required", "error_description": "POST /oauth/token requires TLS; use --no-tls only for localhost dev" }
```

**Response 429** (rate-limited):
```json
{ "error": "rate_limited", "error_description": "10 req/min per clientId; retry after 60s" }
```

### `POST /oauth/authorize` (OIDC, when `--enable-oidc`)

**Request query**:
```
client_id=cli_xxx
redirect_uri=https://app.example.com/callback
scope=product.read
response_type=code
```

**Response 302** (dev stub):
```
Location: https://gateway/oauth/dev-stub-approve?next=/oauth/callback?code=...
```

**Response 403** (when `--enable-oidc=false`):
```json
{ "error": "oidc_disabled", "error_description": "set --enable-oidc on the gateway to use this endpoint" }
```

### `GET /oauth/callback` (OIDC)

**Request query**:
```
code=ABC123
state=<optional, returned to redirect_uri as-is>
```

**Response 302**:
```
Location: <redirect_uri>?code=<new_code>   # dev stub builds a fresh code
```

The fresh code is consumable at `POST /oauth/token` with `grant_type=registration_code&code=<new_code>`.

---

## CLI surface

| Command | What it does |
|---|---|
| `agentide client create --tenant X --name Y --scope '...'` | mint a client. secret → `<data-dir>/clients/.secret-<id>.txt` 0600. exit 0. |
| `agentide client list --tenant X` | table of {id, name, createdAt, revoked, lastUsedAt}. exit 0. |
| `agentide client revoke --client-id X` | flip revoked flag. exit 0. audit row. |
| `agentide client rotate --client-id X` | new secret + grace period. exit 0. |
| `agentide client grant --tenant X --name Y --scope '...'` | registration code. exit 0. `--ttl-min` overrides (default 5). |
| `agentide client redeem --code X` | exchange code for client_id+secret. auto-saves to config.toml. exit 0. |

---

## SDK API

### Current shape (legacy, unchanged):
```typescript
createSdk({
  url: "ws://127.0.0.1:7300/ws",
  token: "eyJ...",
});
```

### New shape (client_credentials, preferred):
```typescript
createSdk({
  url: "ws://127.0.0.1:7300/ws",
  oauthUrl: "http://127.0.0.1:7100",  // base for POST /oauth/token
  clientId: "cli_xxx",
  clientSecret: "<plaintext>",
  onRevoked: () => { console.error("client revoked, exiting"); process.exit(1); },
});
```

### Behavior:
- If both `token` and `clientId` are set → `clientId` wins (backward compatible migration path).
- If `clientId` only → SDK fetches JWT at startup, refreshes when expires < 60s, single in-flight refresh.
- If `token` only → static JWT, no refresh (legacy behavior preserved).
- On 401 with `client_revoked` → close ws, invoke `onRevoked`, no reconnect.

---

## Risks the scenarios cover

| Scenario | Risk addressed |
|---|---|
| S1 | (4) secret in clipboard — secret never prints to stdout by default |
| S1 | (8) rate-limit on `client.create` — 5/hour per operator |
| S2 | (3) secret hashing — salt + SHA-256, never plaintext stored |
| S2 | (1) TLS — first client_credentials call must be over TLS (defaults) |
| S3 | (5) revocation latency — refresh is automatic on expiry |
| S4 | (5) revocation latency — instant, not just on refresh |
| S5 | (4) secret rotation — old secret works for 5min grace |
| S6 | (6) registration code TTL — 5min, one-time |
| S7 | (8) OIDC — auth-code grant when IdP exists |
| S8 | (1) TLS enforcement — 426 when not behind TLS |
| S9 | (2) brute-force — 10 req/min per client_id |
| S10 | (7) backward compatibility — legacy PLATFORM_TOKEN still works |

---

## Verification matrix

| Scenario | Test path |
|---|---|
| S1 | `packages/gateway-core/src/__tests__/client-service.test.ts` + `packages/agentide/src/__tests__/cli.test.ts` |
| S2 | `packages/gateway-core/src/__tests__/oauth-token-handler.test.ts` |
| S3 | `packages/gateway-core/src/__tests__/client-service.test.ts` (refresh tests) + `packages/sdk-node/src/__tests__/client.test.ts` |
| S4 | `packages/gateway-core/src/__tests__/oauth-token-handler.test.ts` + `packages/sdk-node/src/__tests__/client.test.ts` |
| S5 | `packages/gateway-core/src/__tests__/client-service.test.ts` |
| S6 | `packages/gateway-core/src/__tests__/client-service.test.ts` + `packages/agentide/src/__tests__/cli.test.ts` |
| S7 | `packages/gateway-core/src/__tests__/oauth-token-handler.test.ts` |
| S8 | `packages/gateway-core/src/__tests__/oauth-token-handler.test.ts` |
| S9 | `packages/gateway-core/src/__tests__/oauth-token-handler.test.ts` |
| S10 | `packages/sdk-node/src/__tests__/client.test.ts` (legacy config shape) |

**Proposed test count:** 47 unit tests across 4 packages. Plus 1 integration test in `packages/agentide/src/__tests__/integration.test.ts` (3 new cases). Plus 1 post-impl sim.

---

## Non-goals

- **Multi-tenant clients** (one client spanning multiple tenants). Zero demand, zero scope.
- **Token introspection endpoint** (`GET /token/introspect`). Just inspect audit.log.
- **User-level tokens** (humans). OIDC stub is enough for v1; real IdP swap is 5 lines.
- **Refresh-token rotation** (rotation of the refresh token itself). client_credentials don't have refresh tokens in their grant — the secret does the rotation.
- **Distributed rate limiting** (across multiple gateway instances). v1 runs as a single process; multi-instance deploys get per-instance limits (acceptable for v1).
- **Audit metric dashboards.** audit.log is enough.

---

## Operational signals

```
# audit log row for client.create
audit_emit({ action: "client.create", client_id, tenant_id, actor: "operator", timestamp_utc })

# audit log row for revocation
audit_emit({ action: "client.revoke", client_id, actor: "operator", timestamp_utc, revoked_at_client_id })

# structured log for /oauth/token
log("oauth_token request", { client_id, grant_type, status, took_ms })
```

---

## Migration path for existing apps

**Old way** (manual):
```env
PLATFORM_TOKEN=eyJ...   # operator pastes, expires, operator re-pastes
```

**New way** (one-time):
```env
PLATFORM_CLIENT_ID=cli_xxx
PLATFORM_CLIENT_SECRET_FILE=/var/run/agentide/secret.txt   # mounted by k8s or systemd
PLATFORM_OAUTH_URL=http://gateway:7100
```

The SDK auto-detects which mode to use. Both supported during migration.

---

## After this pack lands

the operator's workflow becomes:

```bash
# operator runs ONCE per app lifetime
agentide client create --tenant acme --name nest-app --scope 'product.*'
# → { client_id: "cli_xxx", secret_at: ".../clients/.secret-cli_xxx.txt" }
# operator shells the file contents into nest's .env, deletes the file

# operator can also use the offline path
agentide client grant --tenant acme --name claude-code --scope 'product.read'
# → { code: "rc_xxx", expires_at: now+5min }
# operator sends the code to the agent via out-of-band channel
# agent on first boot: agentide client redeem --code rc_xxx
# → { client_id, client_secret } (auto-saved to config.toml)
```

the SDK handles everything else. **no further manual token work.** token rotation is automatic, revocation is one CLI command, leaks have a 1-hour blast radius (or 0 if rotated immediately).
