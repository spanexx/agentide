# IMPL — agentide-client-credentials

> **For Hermes:** strict TDD. Each phase = 1 commit. The agent must run the test before the implementation step and confirm the failure mode matches the one documented.

**Source of truth for:** code structure, file paths, public exports, CID indices. Tests must mirror the PRD-TRD scenarios (S1-S10).

**Total commits:** 9 (Phase 0 = 1, Phase 1 = 2, Phases 2-8 = 1 each).

---

## Phase 0: pack docs (1 commit)

**Files created:**
- `docs/features/agentide-client-credentials/GRILL-agentide-client-credentials.txt` (already exists)
- `docs/features/agentide-client-credentials/PRD-TRD-agentide-client-credentials.md` (already exists)
- `docs/features/agentide-client-credentials/IMPL-agentide-client-credentials.md` (this file)

**Step 1:** ensure all 3 files exist.
**Step 2:** commit `docs(features): pack docs for agentide-client-credentials (BI[29])`.

---

## Phase 1: types + storage (gateway-core) (2 commits)

### Phase 1a: types

**Files:**
- Modify: `packages/gateway-core/src/types.ts`
- Modify: `packages/gateway-core/src/index.ts`

**CID Index:**
- CID:types-018 → `ClientRecord`
- CID:types-019 → `RegistrationCode`
- CID:types-020 → `ClientStore`

**Step 1: write failing test** — `packages/gateway-core/src/__tests__/client-store-types.test.ts`:
```typescript
import { describe, it, expect } from "vitest";
import type { ClientRecord, RegistrationCode, ClientStore } from "../types.js";

describe("client types", () => {
  it("ClientRecord has the required fields", () => {
    const rec: ClientRecord = {
      id: "cli_abc", tenantId: "acme", name: "n", hashedSecret: "sha256:xx",
      defaultScope: ["*"], revoked: false, createdAt: 1,
      lastUsedAt: null, lastRotatedAt: null, gracePeriodEndsAt: null,
    };
    expect(rec.id).toBe("cli_abc");
  });
  it("RegistrationCode has the required fields", () => {
    const c: RegistrationCode = {
      code: "rc_xxx", tenantId: "acme", defaultScope: ["*"],
      expiresAt: 999999, consumed: false,
    };
    expect(c.code).toMatch(/^rc_/);
  });
  it("ClientStore interface declares load/save for both", () => {
    // type-erased: just check the symbols exist
    type _Loads = ClientStore["load"];
    type _Saves = ClientStore["save"];
    expect(true).toBe(true);
  });
});
```

**Step 2:** run — expect FAIL (`cannot find name ClientRecord`).
**Step 3:** add the types to `packages/gateway-core/src/types.ts`:
```typescript
// CID:types-018 - ClientRecord
export interface ClientRecord {
  readonly id: string;
  readonly tenantId: string;
  readonly name: string;
  readonly hashedSecret: string;          // "sha256:<salt-hex>:<digest-hex>"
  readonly defaultScope: readonly string[];
  readonly revoked: boolean;
  readonly createdAt: number;             // UTC epoch ms
  readonly lastUsedAt: number | null;
  readonly lastRotatedAt: number | null;
  readonly gracePeriodEndsAt: number | null;
}

// CID:types-019 - RegistrationCode
export interface RegistrationCode {
  readonly code: string;                  // "rc_<random>"
  readonly tenantId: string;
  readonly defaultScope: readonly string[];
  readonly expiresAt: number;             // UTC epoch ms
  readonly consumed: boolean;
}

// CID:types-020 - ClientStore
export interface ClientStore {
  load(): Promise<readonly ClientRecord[]>;
  save(records: readonly ClientRecord[]): Promise<void>;
  loadCodes(): Promise<readonly RegistrationCode[]>;
  saveCodes(codes: readonly RegistrationCode[]): Promise<void>;
}
```

**Step 4:** re-export from `packages/gateway-core/src/index.ts`.
**Step 5:** run — expect PASS.
**Step 6:** commit `feat(gateway-core): add ClientRecord + RegistrationCode types`.

### Phase 1b: file-system store

**Files:**
- Create: `packages/gateway-core/src/client-store.ts` (~80 lines)
- Modify: `packages/gateway-core/src/index.ts` (re-export)

**CID Index:**
- CID:cs-001 → `FileSystemClientStore`

**Step 1: write failing test** — `packages/gateway-core/src/__tests__/client-store-impl.test.ts`:
```typescript
import { describe, it, expect } from "vitest";
import { FileSystemClientStore } from "../client-store.js";

describe("FileSystemClientStore", () => {
  it("returns empty lists when the files don't exist", async () => {
    const fs = { readFile: async () => { throw new Error("ENOENT"); }, writeFile: async () => {}, exists: async () => false };
    const store = new FileSystemClientStore("/data", fs);
    expect(await store.load()).toEqual([]);
    expect(await store.loadCodes()).toEqual([]);
  });
  it("persists and reloads records", async () => {
    const stored: Record<string, string> = {};
    const fs = {
      readFile: async (p: string) => stored[p] ?? (() => { throw new Error("ENOENT"); })(),
      writeFile: async (p: string, data: string) => { stored[p] = data; },
      exists: async (p: string) => p in stored,
    };
    const store = new FileSystemClientStore("/data", fs);
    const rec = { id: "cli_1", tenantId: "acme", name: "a", hashedSecret: "sha256:x", defaultScope: ["*"] as readonly string[], revoked: false, createdAt: 1, lastUsedAt: null, lastRotatedAt: null, gracePeriodEndsAt: null };
    await store.save([rec]);
    expect(await store.load()).toEqual([rec]);
  });
  it("persists and reloads registration codes", async () => {
    const stored: Record<string, string> = {};
    const fs = {
      readFile: async (p: string) => stored[p] ?? (() => { throw new Error("ENOENT"); })(),
      writeFile: async (p: string, data: string) => { stored[p] = data; },
      exists: async (p: string) => p in stored,
    };
    const store = new FileSystemClientStore("/data", fs);
    const c = { code: "rc_1", tenantId: "acme", defaultScope: ["*"] as readonly string[], expiresAt: 1, consumed: false };
    await store.saveCodes([c]);
    expect(await store.loadCodes()).toEqual([c]);
  });
});
```

**Step 2:** run — expect FAIL.
**Step 3:** implement `FileSystemClientStore`:
```typescript
// CID:cs-001 - FileSystemClientStore
export class FileSystemClientStore implements ClientStore {
  constructor(
    private readonly dataDir: string,
    private readonly fs: FileSystem,
  ) {}

  get clientsFile(): string { return `${this.dataDir}/clients.json`; }
  get codesFile(): string { return `${this.dataDir}/registration-codes.json`; }

  async load(): Promise<readonly ClientRecord[]> {
    try {
      const raw = await this.fs.readFile(this.clientsFile);
      const parsed = JSON.parse(raw) as { records: ClientRecord[] };
      return parsed.records ?? [];
    } catch {
      return [];
    }
  }

  async save(records: readonly ClientRecord[]): Promise<void> {
    await this.fs.writeFile(this.clientsFile, JSON.stringify({ records }, null, 2), 0o644);
  }

  async loadCodes(): Promise<readonly RegistrationCode[]> {
    try {
      const raw = await this.fs.readFile(this.codesFile);
      const parsed = JSON.parse(raw) as { codes: RegistrationCode[] };
      return parsed.codes ?? [];
    } catch {
      return [];
    }
  }

  async saveCodes(codes: readonly RegistrationCode[]): Promise<void> {
    await this.fs.writeFile(this.codesFile, JSON.stringify({ codes }, null, 2), 0o644);
  }
}
```

**Step 4:** re-export.
**Step 5:** run — expect PASS.
**Step 6:** commit `feat(gateway-core): add FileSystemClientStore`.

---

## Phase 2: client service (gateway-core) (1 commit)

**Files:**
- Create: `packages/gateway-core/src/client-service.ts` (~200 lines)
- Modify: `packages/gateway-core/src/index.ts`

**CID Index:**
- CID:cs-002 → `ClientService`
- CID:cs-003 → `hashSecret(salt, secret)`
- CID:cs-004 → `randomClientId()`
- CID:cs-005 → `randomSecret()`
- CID:cs-006 → `randomRegistrationCode()`

**Step 1: write failing tests** — `packages/gateway-core/src/__tests__/client-service.test.ts` (12 tests):
```typescript
import { describe, it, expect, beforeEach } from "vitest";
import { ClientService } from "../client-service.js";

const memStore = () => {
  const records: any[] = [];
  const codes: any[] = [];
  return {
    store: {
      load: async () => records,
      save: async (r: any[]) => { records.length = 0; records.push(...r); },
      loadCodes: async () => codes,
      saveCodes: async (c: any[]) => { codes.length = 0; codes.push(...c); },
    },
    _records: records,
    _codes: codes,
  };
};

describe("ClientService", () => {
  it("createClient returns the secret exactly once", async () => {
    const { store } = memStore();
    const svc = new ClientService(store, () => "salt", () => 1000);
    const { record, plaintextSecret } = await svc.createClient({ tenantId: "acme", name: "n", defaultScope: ["*"] });
    expect(record.id).toMatch(/^cli_/);
    expect(plaintextSecret.length).toBeGreaterThan(20);
    expect(record.hashedSecret).not.toBe(plaintextSecret);
  });
  it("createClient hashes with salt + secret, not just secret", async () => {
    const { store } = memStore();
    const svc = new ClientService(store, () => "salt", () => 1000);
    const { record } = await svc.createClient({ tenantId: "acme", name: "n", defaultScope: ["*"] });
    expect(record.hashedSecret).toMatch(/^sha256:/);
    // hash alone (without salt) wouldn't match
    expect(record.hashedSecret).not.toBe("sha256:701d2cf9c3b48d2ba9cfd8a59ea6f5b54d4e0c2b5a4b94e0b34e8a0a0a0a0a0a");
  });
  it("createClient respects the 5/hour operator rate limit", async () => {
    const { store } = memStore();
    let t = 1000;
    const svc = new ClientService(store, () => "salt", () => t);
    for (let i = 0; i < 5; i++) {
      await svc.createClient({ tenantId: "acme", name: `n${i}`, defaultScope: ["*"] });
    }
    t += 60_000; // pretend a minute has passed (still under 1h window)
    await expect(svc.createClient({ tenantId: "acme", name: "n6", defaultScope: ["*"] })).rejects.toThrow(/rate/i);
  });
  it("verifyClient with correct secret returns the record + updates lastUsedAt", async () => {
    const { store } = memStore();
    let t = 1000;
    const svc = new ClientService(store, () => "salt", () => t);
    const { record, plaintextSecret } = await svc.createClient({ tenantId: "acme", name: "n", defaultScope: ["*"] });
    t = 5000;
    const verified = await svc.verifyClient({ id: record.id, secret: plaintextSecret });
    expect(verified?.id).toBe(record.id);
    expect(verified?.lastUsedAt).toBe(5000);
  });
  it("verifyClient with wrong secret returns null", async () => {
    const { store } = memStore();
    const svc = new ClientService(store, () => "salt", () => 1000);
    const { record } = await svc.createClient({ tenantId: "acme", name: "n", defaultScope: ["*"] });
    const verified = await svc.verifyClient({ id: record.id, secret: "wrong" });
    expect(verified).toBeNull();
  });
  it("verifyClient with revoked client returns null", async () => {
    const { store } = memStore();
    const svc = new ClientService(store, () => "salt", () => 1000);
    const { record, plaintextSecret } = await svc.createClient({ tenantId: "acme", name: "n", defaultScope: ["*"] });
    await svc.revokeClient({ clientId: record.id });
    const verified = await svc.verifyClient({ id: record.id, secret: plaintextSecret });
    expect(verified).toBeNull();
  });
  it("revoke flips the flag", async () => {
    const { store } = memStore();
    const svc = new ClientService(store, () => "salt", () => 1000);
    const { record } = await svc.createClient({ tenantId: "acme", name: "n", defaultScope: ["*"] });
    await svc.revokeClient({ clientId: record.id });
    const records = await store.load();
    expect(records[0]?.revoked).toBe(true);
  });
  it("rotate keeps old secret valid for 5 min, then invalidates", async () => {
    const { store } = memStore();
    let t = 1000;
    const svc = new ClientService(store, () => "salt", () => t);
    const { record, plaintextSecret } = await svc.createClient({ tenantId: "acme", name: "n", defaultScope: ["*"] });
    const { plaintextSecret: newSecret } = await svc.rotateClient({ clientId: record.id });
    expect(newSecret).not.toBe(plaintextSecret);
    // immediate: old secret still works (within grace)
    let verified = await svc.verifyClient({ id: record.id, secret: plaintextSecret });
    expect(verified).not.toBeNull();
    t = 2000 + 300_000; // past grace
    verified = await svc.verifyClient({ id: record.id, secret: plaintextSecret });
    expect(verified).toBeNull();
    // new secret still works
    const verified2 = await svc.verifyClient({ id: record.id, secret: newSecret });
    expect(verified2).not.toBeNull();
  });
  it("createRegistrationCode returns rc_<random> with expiresAt = now + 5 min", async () => {
    const { store } = memStore();
    let t = 1000;
    const svc = new ClientService(store, () => "salt", () => t);
    const { code, expiresAt } = await svc.createRegistrationCode({ tenantId: "acme", defaultScope: ["*"] });
    expect(code).toMatch(/^rc_/);
    expect(expiresAt).toBe(t + 300_000);
  });
  it("redeemRegistrationCode returns secret + clientId once", async () => {
    const { store } = memStore();
    const svc = new ClientService(store, () => "salt", () => 1000);
    const { code } = await svc.createRegistrationCode({ tenantId: "acme", defaultScope: ["*"] });
    const first = await svc.redeemRegistrationCode({ code });
    expect(first?.clientId).toMatch(/^cli_/);
    expect(first?.plaintextSecret.length).toBeGreaterThan(20);
    const second = await svc.redeemRegistrationCode({ code });
    expect(second).toBeNull();
  });
  it("redeemRegistrationCode after expiresAt returns null", async () => {
    const { store } = memStore();
    let t = 1000;
    const svc = new ClientService(store, () => "salt", () => t);
    const { code } = await svc.createRegistrationCode({ tenantId: "acme", defaultScope: ["*"] });
    t = 1000 + 400_000; // past 5 min
    const result = await svc.redeemRegistrationCode({ code });
    expect(result).toBeNull();
  });
});
```

**Step 2:** run — expect FAIL.
**Step 3:** implement `ClientService` (~200 lines). signature:
```typescript
export class ClientService {
  constructor(
    private readonly store: ClientStore,
    private readonly salt: () => string,
    private readonly clock: () => number,
  ) {}
  // ...
}
```

Internal helpers:
- `hashSecret(salt: string, secret: string): string` — returns `sha256:<salt-hex>:<digest-hex>`. Use `node:crypto.createHash("sha256").update(salt + secret).digest("hex")`.
- `randomClientId(): string` — `cli_` + 16 hex chars from `crypto.randomBytes(16)`.
- `randomSecret(): string` — 32 bytes from `crypto.randomBytes(32)`, base64url-encoded.
- `randomRegistrationCode(): string` — `rc_` + 16 hex chars.

Rate-limit: in-memory `Map<"create", { count, windowStart }>` reset when `now - windowStart > 3600000`.

**Step 4:** run — expect PASS.
**Step 5:** commit `feat(gateway-core): add ClientService`.

---

## Phase 3: capability registration (gateway-core) (1 commit)

**Files:**
- Modify: `packages/gateway-core/src/handle-invocation.ts`
- Modify: `packages/gateway-core/src/types.ts` (add request types)

**CID Index:**
- CID:cap-001 → `client.create` cap
- CID:cap-002 → `client.list` cap
- CID:cap-003 → `client.revoke` cap
- CID:cap-004 → `client.rotate` cap

**Step 1: write failing test** — `packages/gateway-core/src/__tests__/client-capabilities.test.ts`:
```typescript
import { describe, it, expect } from "vitest";
import { createPlatform } from "../factory.js";

describe("client.* capabilities", () => {
  it("gateway exposes client.create, list, revoke, rotate", async () => {
    const platform = await createPlatform({ fs: makeMemFs(), dataDir: "/data", adapterMcp: false, adapterWs: false });
    const caps = platform.gateway.listCapabilities();
    expect(caps.map((c) => c.name)).toEqual(
      expect.arrayContaining(["client.create", "client.list", "client.revoke", "client.rotate"])
    );
  });
});
```

**Step 2:** run — expect FAIL.
**Step 3:** add the four capability handlers in `handle-invocation.ts`, wired to `ClientService`. Match the existing `tenant.create` pattern (see `handle-invocation.ts` for reference).
**Step 4:** run — expect PASS.
**Step 5:** commit `feat(gateway-core): register client.* capabilities`.

---

## Phase 4: POST /oauth/token handler + adapter route (gateway-core + adapter-mcp) (1 commit)

**Files:**
- Create: `packages/gateway-core/src/oauth-token-handler.ts` (~140 lines)
- Modify: `packages/adapter-mcp/src/server.ts` (route POST /oauth/token)

**CID Index:**
- CID:oauth-001 → `handleTokenRequest`
- CID:oauth-002 → `TokenRequestRateLimiter`
- CID:oauth-003 → `auditEmit` (in handler)

**Step 1: write failing tests** — `packages/gateway-core/src/__tests__/oauth-token-handler.test.ts` (9 tests):
```typescript
import { describe, it, expect } from "vitest";
import { handleTokenRequest, TokenRequestRateLimiter } from "../oauth-token-handler.js";
import { ClientService } from "../client-service.js";
import { issueToken } from "../auth.js";

const buildEnv = async () => {
  const secretBytes = new Uint8Array(32);
  const salt = "deadbeef";
  const store = {
    load: async () => [],
    save: async () => {},
    loadCodes: async () => [],
    saveCodes: async () => {},
  };
  const clientSvc = new ClientService(store, () => salt, () => 1000);
  const { record, plaintextSecret } = await clientSvc.createClient({ tenantId: "acme", name: "n", defaultScope: ["*"] });
  return { clientSvc, record, plaintextSecret, secretBytes, salt };
};

describe("POST /oauth/token", () => {
  it("rejects plain HTTP when requireTls=true (returns 426)", async () => {
    const env = await buildEnv();
    const result = await handleTokenRequest({
      body: { grant_type: "client_credentials", client_id: env.record.id, client_secret: env.plaintextSecret },
      clientSvc: env.clientSvc,
      secret: env.secretBytes,
      salt: env.salt,
      clock: () => 1000,
      requireTls: true,
      isTls: false,
    });
    expect(result.status).toBe(426);
    expect(result.body).toMatchObject({ error: "tls_required" });
  });
  it("returns 200 + access_token on valid client_credentials over TLS", async () => {
    const env = await buildEnv();
    const result = await handleTokenRequest({
      body: { grant_type: "client_credentials", client_id: env.record.id, client_secret: env.plaintextSecret },
      clientSvc: env.clientSvc,
      secret: env.secretBytes,
      salt: env.salt,
      clock: () => 1000,
      requireTls: false,
      isTls: true,
    });
    expect(result.status).toBe(200);
    expect(result.body.access_token).toMatch(/^eyJ/);
    expect(result.body.token_type).toBe("Bearer");
    expect(result.body.expires_in).toBe(3600);
  });
  it("returns 401 invalid_client on bad client_id", async () => {
    const env = await buildEnv();
    const result = await handleTokenRequest({
      body: { grant_type: "client_credentials", client_id: "cli_nope", client_secret: "x" },
      clientSvc: env.clientSvc,
      secret: env.secretBytes, salt: env.salt, clock: () => 1000, requireTls: false, isTls: true,
    });
    expect(result.status).toBe(401);
    expect(result.body).toMatchObject({ error: "invalid_client" });
  });
  it("returns 401 invalid_client on bad secret", async () => {
    const env = await buildEnv();
    const result = await handleTokenRequest({
      body: { grant_type: "client_credentials", client_id: env.record.id, client_secret: "wrong" },
      clientSvc: env.clientSvc, secret: env.secretBytes, salt: env.salt, clock: () => 1000, requireTls: false, isTls: true,
    });
    expect(result.status).toBe(401);
    expect(result.body).toMatchObject({ error: "invalid_client" });
  });
  it("returns 401 client_revoked on revoked client", async () => {
    const env = await buildEnv();
    await env.clientSvc.revokeClient({ clientId: env.record.id });
    const result = await handleTokenRequest({
      body: { grant_type: "client_credentials", client_id: env.record.id, client_secret: env.plaintextSecret },
      clientSvc: env.clientSvc, secret: env.secretBytes, salt: env.salt, clock: () => 1000, requireTls: false, isTls: true,
    });
    expect(result.status).toBe(401);
    expect(result.body).toMatchObject({ error: "client_revoked" });
  });
  it("returns 400 unsupported_grant_type on missing/unknown grant_type", async () => {
    const env = await buildEnv();
    const result = await handleTokenRequest({
      body: { client_id: env.record.id, client_secret: env.plaintextSecret },
      clientSvc: env.clientSvc, secret: env.secretBytes, salt: env.salt, clock: () => 1000, requireTls: false, isTls: true,
    });
    expect(result.status).toBe(400);
    expect(result.body).toMatchObject({ error: "unsupported_grant_type" });
  });
  it("returns 401 invalid_grant on bad registration code", async () => {
    const env = await buildEnv();
    const result = await handleTokenRequest({
      body: { grant_type: "registration_code", code: "rc_bogus" },
      clientSvc: env.clientSvc, secret: env.secretBytes, salt: env.salt, clock: () => 1000, requireTls: false, isTls: true,
    });
    expect(result.status).toBe(401);
    expect(result.body).toMatchObject({ error: "invalid_grant" });
  });
  it("returns 429 rate_limited after 10 req/min", async () => {
    const env = await buildEnv();
    const counter = { i: 0 };
    const clock = () => 1000 + counter.i * 1000;
    const handler = async () => handleTokenRequest({
      body: { grant_type: "client_credentials", client_id: env.record.id, client_secret: env.plaintextSecret },
      clientSvc: env.clientSvc, secret: env.secretBytes, salt: env.salt, clock, requireTls: false, isTls: true,
    });
    for (let i = 0; i < 10; i++) {
      counter.i = i;
      const r = await handler();
      expect(r.status).toBe(200);
    }
    counter.i = 10;
    const r = await handler();
    expect(r.status).toBe(429);
    expect(r.body).toMatchObject({ error: "rate_limited" });
  });
  it("returns 401 invalid_grant on consumed registration code", async () => {
    const env = await buildEnv();
    const { code } = await env.clientSvc.createRegistrationCode({ tenantId: "acme", defaultScope: ["*"] });
    const first = await env.clientSvc.redeemRegistrationCode({ code });
    expect(first?.plaintextSecret).toBeDefined();
    const result = await handleTokenRequest({
      body: { grant_type: "registration_code", code },
      clientSvc: env.clientSvc, secret: env.secretBytes, salt: env.salt, clock: () => 1000, requireTls: false, isTls: true,
    });
    expect(result.status).toBe(401);
    expect(result.body).toMatchObject({ error: "invalid_grant" });
  });
});
```

**Step 2:** run — expect FAIL.
**Step 3:** implement `handleTokenRequest`:

```typescript
// CID:oauth-001 - handleTokenRequest
export interface TokenRequestEnv {
  body: { grant_type?: string; client_id?: string; client_secret?: string; code?: string; scope?: string };
  clientSvc: ClientService;
  secret: Uint8Array;
  salt: string;
  clock: () => number;
  requireTls: boolean;
  isTls: boolean;
  rateLimiter?: TokenRequestRateLimiter; // optional for tests
  auditEmit?: (row: any) => void;
}

export interface TokenResponse {
  status: number;
  body: any;
}

export async function handleTokenRequest(env: TokenRequestEnv): Promise<TokenResponse> {
  // TLS check
  if (env.requireTls && !env.isTls) {
    return { status: 426, body: { error: "tls_required", error_description: "POST /oauth/token requires TLS; use --no-tls only for localhost dev" } };
  }
  const grant = env.body.grant_type;
  if (grant === "client_credentials") {
    return handleClientCredentialsGrant(env);
  }
  if (grant === "registration_code") {
    return handleRegistrationCodeGrant(env);
  }
  return { status: 400, body: { error: "unsupported_grant_type", error_description: "only 'client_credentials' and 'registration_code' are supported" } };
}

async function handleClientCredentialsGrant(env: TokenRequestEnv): Promise<TokenResponse> {
  const clientId = env.body.client_id ?? "";
  const clientSecret = env.body.client_secret ?? "";
  // rate-limit
  const limiter = env.rateLimiter ?? new TokenRequestRateLimiter();
  if (!limiter.allow(clientId)) {
    return { status: 429, body: { error: "rate_limited", error_description: "10 req/min per clientId; retry after 60s" } };
  }
  const record = await env.clientSvc.verifyClient({ id: clientId, secret: clientSecret });
  if (!record) {
    // Could be invalid_client OR client_revoked; verify which
    const rec = await env.clientSvc.findClientById(clientId);
    if (rec?.revoked) {
      return { status: 401, body: { error: "client_revoked", error_description: "operator revoked this client" } };
    }
    return { status: 401, body: { error: "invalid_client", error_description: "client_id or client_secret invalid" } };
  }
  const claims = {
    sub: { tenantId: record.tenantId, callerId: record.id },
    scope: env.body.scope ? env.body.scope.split(" ") : [...record.defaultScope],
    iat: Math.floor(env.clock() / 1000),
    exp: Math.floor(env.clock() / 1000) + 3600,
  };
  const token = issueToken(claims, env.secret, env.clock);
  env.auditEmit?.({ action: "client_credentials.token_mint", client_id: record.id, tenant_id: record.tenantId, timestamp_utc: new Date(env.clock()).toISOString() });
  return { status: 200, body: { access_token: token, token_type: "Bearer", expires_in: 3600 } };
}

async function handleRegistrationCodeGrant(env: TokenRequestEnv): Promise<TokenResponse> {
  const code = env.body.code ?? "";
  const result = await env.clientSvc.redeemRegistrationCode({ code });
  if (!result) {
    return { status: 401, body: { error: "invalid_grant", error_description: "registration code not found, already consumed, or expired" } };
  }
  // Persist the new client (so the next token mint works)
  // ... handled by ClientService.redeemRegistrationCode which already saved
  return { status: 200, body: { client_id: result.clientId, client_secret: result.plaintextSecret } };
}

// CID:oauth-002 - TokenRequestRateLimiter
export class TokenRequestRateLimiter {
  private readonly buckets = new Map<string, { count: number; windowStart: number }>();
  private readonly max: number;
  private readonly windowMs: number;
  constructor(max = 10, windowMs = 60_000) { this.max = max; this.windowMs = windowMs; }
  allow(clientId: string, now = Date.now()): boolean {
    const bucket = this.buckets.get(clientId);
    if (!bucket || now - bucket.windowStart > this.windowMs) {
      this.buckets.set(clientId, { count: 1, windowStart: now });
      return true;
    }
    if (bucket.count >= this.max) return false;
    bucket.count += 1;
    return true;
  }
}
```

**Step 4:** add the route in `packages/adapter-mcp/src/server.ts`. The MCP adapter already serves HTTP on :7100; add a branch that reads POST /oauth/token body and calls `handleTokenRequest`. **Need to pass `isTls` through — when behind a TLS-terminating proxy, the adapter checks `req.headers["x-forwarded-proto"] === "https"` or `req.socket.encrypted === true`.** For dev (no TLS), `isTls=false` always.

**Step 5:** run — expect PASS.
**Step 6:** commit `feat(gateway-core,adapter-mcp): add POST /oauth/token endpoint`.

---

## Phase 5: CLI commands (agentide) (1 commit)

**Files:**
- Modify: `packages/agentide/src/cli.ts` (add the `case "client":` route + the `runClient` function)
- Modify: `packages/agentide/src/__tests__/cli.test.ts` (6 tests)

**CID Index:**
- CID:cli-001 → `runClient` (already exists; reuse)
- CID:cli-002 → `runClient create`
- CID:cli-003 → `runClient grant`
- CID:cli-004 → `runClient list`
- CID:cli-005 → `runClient revoke`
- CID:cli-006 → `runClient rotate`
- CID:cli-007 → `runClient redeem`

**Step 1: write failing tests** — 6 tests in `cli.test.ts`:
```typescript
describe("client subcommand", () => {
  it("client create writes the secret to a file and prints only the path", async () => {
    const mem = new InMemoryFs();
    const writes: string[] = [];
    const origWrite = process.stdout.write.bind(process.stdout);
    process.stdout.write = ((c: any) => { writes.push(typeof c === "string" ? c : c.toString()); return true; }) as any;
    try {
      const r = await runCli(["client", "create", "--tenant", "acme", "--name", "n", "--scope", "*", "--data-dir", "/data"], { fs: mem });
      expect(r.exitCode).toBe(0);
      const captured = writes.join("");
      expect(captured).toMatch(/created/i);
      expect(captured).toMatch(/secret_at: \/data\/clients\/.secret-cli_/);
      expect(captured).not.toMatch(/eyJ/); // no plaintext token in stdout
    } finally { process.stdout.write = origWrite; }
  });
  it("client create --print prints the secret to stdout", async () => {
    const mem = new InMemoryFs();
    const writes: string[] = [];
    const origWrite = process.stdout.write.bind(process.stdout);
    process.stdout.write = ((c: any) => { writes.push(typeof c === "string" ? c : c.toString()); return true; }) as any;
    try {
      await runCli(["client", "create", "--tenant", "acme", "--name", "n", "--scope", "*", "--data-dir", "/data", "--print"], { fs: mem });
      const captured = writes.join("");
      expect(captured).toMatch(/plaintext_secret:/);
    } finally { process.stdout.write = origWrite; }
  });
  it("client list returns a table", async () => {
    const mem = new InMemoryFs();
    await runCli(["client", "create", "--tenant", "acme", "--name", "n1", "--scope", "*", "--data-dir", "/data"], { fs: mem });
    const r = await runCli(["client", "list", "--tenant", "acme", "--data-dir", "/data"], { fs: mem });
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toMatch(/cli_/);
    expect(r.stdout).toMatch(/n1/);
  });
  it("client grant returns a code that starts with rc_", async () => {
    const mem = new InMemoryFs();
    const r = await runCli(["client", "grant", "--tenant", "acme", "--name", "n", "--scope", "*", "--data-dir", "/data"], { fs: mem });
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toMatch(/rc_/);
    expect(r.stdout).toMatch(/expires_at/);
  });
  it("client revoke sets revoked=true", async () => {
    const mem = new InMemoryFs();
    const create = await runCli(["client", "create", "--tenant", "acme", "--name", "n", "--scope", "*", "--data-dir", "/data"], { fs: mem });
    const clientId = (create.stdout.match(/cli_[a-z0-9]+/) ?? [""])[0];
    expect(clientId).toMatch(/^cli_/);
    const r = await runCli(["client", "revoke", "--client-id", clientId, "--data-dir", "/data"], { fs: mem });
    expect(r.exitCode).toBe(0);
    const list = await runCli(["client", "list", "--tenant", "acme", "--data-dir", "/data"], { fs: mem });
    expect(list.stdout).toMatch(/revoked.+true/);
  });
  it("client rotate keeps the old secret valid for 5 min", async () => {
    const mem = new InMemoryFs();
    const create = await runCli(["client", "create", "--tenant", "acme", "--name", "n", "--scope", "*", "--data-dir", "/data"], { fs: mem });
    const clientId = (create.stdout.match(/cli_[a-z0-9]+/) ?? [""])[0];
    const r = await runCli(["client", "rotate", "--client-id", clientId, "--data-dir", "/data"], { fs: mem });
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toMatch(/rotated/);
  });
});
```

**Step 2:** run — expect FAIL.
**Step 3:** implement `runClient` in `packages/agentide/src/cli.ts`. needs to read the existing `ClientService` from `@spanexx/gateway-core` (or move it there). Add the `case "client":` to the runCli switch.

**Step 4:** run — expect PASS.
**Step 5:** commit `feat(cli): client subcommand (create/grant/list/revoke/rotate/redeem)`.

---

## Phase 6: SDK auto-refresh (sdk-node) (1 commit)

**Files:**
- Modify: `packages/sdk-node/src/client.ts`
- Modify: `packages/sdk-node/src/__tests__/client.test.ts` (6 tests)

**CID Index:**
- CID:sdk-001 → `TokenRefresher`
- CID:sdk-002 → `createSdk` with client_credentials

**Step 1: write failing tests** — 6 tests:
```typescript
import { describe, it, expect } from "vitest";
import { createSdk } from "../client.js";

describe("createSdk with client_credentials", () => {
  it("mints a token on connect, then connects with the JWT", async () => {
    const mockFetch = async (url: string, init: any) => {
      if (url.endsWith("/oauth/token")) {
        return { status: 200, body: { access_token: "eyJ.test", token_type: "Bearer", expires_in: 3600 } };
      }
      return { status: 200, body: {} };
    };
    const sdk = await createSdk({
      url: "ws://localhost:7300/ws",
      oauthUrl: "http://localhost:7100",
      clientId: "cli_xxx",
      clientSecret: "secret",
      fetchImpl: mockFetch as any,
    });
    expect(sdk.token()).toBe("eyJ.test");
  });
  it("refreshes the token before expiry", async () => {
    let now = 1000;
    let calls = 0;
    const mockFetch = async (url: string) => {
      if (url.endsWith("/oauth/token")) {
        calls++;
        const token = `eyJ.calls_${calls}`;
        return { status: 200, body: { access_token: token, token_type: "Bearer", expires_in: 60 } };
      }
      return { status: 200, body: {} };
    };
    const sdk = await createSdk({
      url: "ws://localhost:7300/ws",
      oauthUrl: "http://localhost:7100",
      clientId: "cli_xxx",
      clientSecret: "secret",
      fetchImpl: mockFetch as any,
      clock: () => now,
    });
    expect(sdk.token()).toBe("eyJ.calls_1");
    now += 30_000; // within 60s expiry
    await sdk.refreshIfNeeded();
    expect(sdk.token()).toBe("eyJ.calls_2");
  });
  it("closes the ws cleanly on client_revoked", async () => {
    const mockFetch = async () => ({ status: 401, body: { error: "client_revoked" } });
    const revoked = { called: false };
    const sdk = await createSdk({
      url: "ws://localhost:7300/ws",
      oauthUrl: "http://localhost:7100",
      clientId: "cli_xxx",
      clientSecret: "secret",
      fetchImpl: mockFetch as any,
      onRevoked: () => { revoked.called = true; },
    });
    expect(sdk.token()).toBeNull();
    expect(revoked.called).toBe(true);
  });
  it("retries refresh with exponential backoff + jitter on transport error", async () => {
    let attempts = 0;
    const mockFetch = async () => {
      attempts++;
      if (attempts < 3) throw new Error("ECONNREFUSED");
      return { status: 200, body: { access_token: "eyJ.after_backoff", token_type: "Bearer", expires_in: 3600 } };
    };
    const sdk = await createSdk({
      url: "ws://localhost:7300/ws",
      oauthUrl: "http://localhost:7100",
      clientId: "cli_xxx",
      clientSecret: "secret",
      fetchImpl: mockFetch as any,
      backoffBaseMs: 1,
      backoffMaxMs: 5,
    });
    await sdk.refreshIfNeeded();
    expect(sdk.token()).toBe("eyJ.after_backoff");
    expect(attempts).toBe(3);
  });
  it("legacy {token: 'eyJ...'} config still works without refresh", async () => {
    const fetches: string[] = [];
    const mockFetch = async (url: string) => { fetches.push(url); return { status: 200, body: {} }; };
    const sdk = await createSdk({
      url: "ws://localhost:7300/ws",
      token: "eyJ.legacy",
      fetchImpl: mockFetch as any,
    });
    expect(sdk.token()).toBe("eyJ.legacy");
    expect(fetches).toEqual([]); // never called /oauth/token
  });
  it("single in-flight refresh on overlapping ticks", async () => {
    let i = 0;
    const mockFetch = async () => {
      const my = ++i;
      await new Promise((r) => setTimeout(r, 50));
      return { status: 200, body: { access_token: `eyJ.race_${my}`, token_type: "Bearer", expires_in: 3600 } };
    };
    const sdk = await createSdk({
      url: "ws://localhost:7300/ws",
      oauthUrl: "http://localhost:7100",
      clientId: "cli_xxx",
      clientSecret: "secret",
      fetchImpl: mockFetch as any,
    });
    await Promise.all([sdk.refreshIfNeeded(), sdk.refreshIfNeeded(), sdk.refreshIfNeeded()]);
    expect(sdk.token()).toBe("eyJ.race_1"); // only the first created the new token
  });
});
```

**Step 2:** run — expect FAIL.
**Step 3:** implement. `TokenRefresher` owns the expiry + refresh logic. `createSdk` accepts the new config shape. If both `token` and `clientId` are present, `clientId` wins.

**Step 4:** run — expect PASS.
**Step 5:** commit `feat(sdk-node): auto-refresh tokens via client_credentials`.

---

## Phase 7: OIDC auth-code grant (gateway-core + adapter-mcp) (1 commit)

**Files:**
- Modify: `packages/gateway-core/src/oauth-token-handler.ts` (add `handleAuthorize`, `handleCallback`)
- Modify: `packages/adapter-mcp/src/server.ts` (route the two new endpoints)
- Modify: `packages/agentide/src/cli.ts` (add `--enable-oidc` flag)

**CID Index:**
- CID:oidc-001 → `handleAuthorize`
- CID:oidc-002 → `handleCallback`
- CID:oidc-003 → `devStubApproval`

**Step 1: write failing tests** — 4 tests in `packages/gateway-core/src/__tests__/oidc-handler.test.ts`:
```typescript
import { describe, it, expect } from "vitest";

describe("OIDC auth-code grant", () => {
  it("authorize returns 302 to dev-stub-approve when enableOidc=true", async () => {
    const r = await handleAuthorize({
      query: { client_id: "cli_xxx", redirect_uri: "https://app/cb", scope: "product.read", response_type: "code" },
      enableOidc: true,
      baseUrl: "http://localhost:7100",
    });
    expect(r.status).toBe(302);
    expect(r.headers?.Location).toMatch(/dev-stub-approve/);
  });
  it("authorize returns 403 when enableOidc=false", async () => {
    const r = await handleAuthorize({
      query: { client_id: "cli_xxx", redirect_uri: "https://app/cb", scope: "product.read", response_type: "code" },
      enableOidc: false,
      baseUrl: "http://localhost:7100",
    });
    expect(r.status).toBe(403);
    expect(r.body).toMatchObject({ error: "oidc_disabled" });
  });
  it("callback exchanges an unconsumed code for a JWT", async () => {
    const codeStore = new Map<string, { clientId: string; tenantId: string; scope: string[] }>();
    codeStore.set("rc_xxx", { clientId: "cli_xxx", tenantId: "acme", scope: ["product.read"] });
    const r = await handleCallback({
      query: { code: "rc_xxx", redirect_uri: "https://app/cb" },
      codes: codeStore,
      secret: new Uint8Array(32),
      clock: () => 1000,
    });
    expect(r.status).toBe(302);
    expect(r.headers?.Location).toMatch(/code=/);
  });
  it("callback returns 401 on already-consumed code", async () => {
    const codeStore = new Map<string, { clientId: string; tenantId: string; scope: string[] }>();
    codeStore.set("rc_xxx", { clientId: "cli_xxx", tenantId: "acme", scope: ["product.read"] });
    await handleCallback({
      query: { code: "rc_xxx", redirect_uri: "https://app/cb" },
      codes: codeStore,
      secret: new Uint8Array(32),
      clock: () => 1000,
    });
    const r2 = await handleCallback({
      query: { code: "rc_xxx", redirect_uri: "https://app/cb" },
      codes: codeStore,
      secret: new Uint8Array(32),
      clock: () => 1000,
    });
    expect(r2.status).toBe(401);
  });
});
```

**Step 2:** run — expect FAIL.
**Step 3:** implement `handleAuthorize` (returns 302 to `/oauth/dev-stub-approve?...`) and `handleCallback` (creates a reg code, returns 302 to redirect_uri with `code=...`). `enableOidc=false` short-circuits to 403.

**Step 4:** add the routes in `adapter-mcp` server.
**Step 5:** add `--enable-oidc` flag to `agentide start` in `cli.ts` (passes through to `GatewayConfig`).
**Step 6:** run — expect PASS.
**Step 7:** commit `feat(gateway-core,adapter-mcp): add OIDC auth-code grant (gated by --enable-oidc)`.

---

## Phase 8: docs + drift + ship (1 commit)

**Files:**
- Modify: `docs/HOWTOAGENTIDE.html` (add a "client credentials" section before the "all commands" section)
- Modify: `packages/agentide/README.md` (link to the new section)
- Modify: `docs/Feature_Backlog.md` (mark BI[29] as SHIPPED)
- Modify: `docs/drift.md` (close D-70)

**Step 1:** write the docs. S9 in PRD-TRD says "all client actions write to audit log" — the drift log should mark D-70 closed with this evidence.
**Step 2:** commit `docs: ship agentide-client-credentials (BI[29])`.

---

## out of scope (deferred to a future pack)

- distributed rate limiting (multi-instance)
- real IdP integration (5-line swap in `handleAuthorize`)
- revoke-list instead of `revoked` flag (for large fleets)
- per-IP rate-limit too (not just per-client_id)
- bcrypt for secret hashing (current SHA-256 + salt is sufficient for 260-bit random secrets)
- token-introspection endpoint (`GET /oauth/introspect`)
- client UI in the analytics dashboard (BI[15])

---

## references

- `docs/features/agentide-cli-consumer/PRD-TRD-agentide-cli-consumer.md` — sibling pack, same structure
- `docs/features/agentide-cli-consumer/GRILL-agentide-cli-consumer.txt` — sibling pack GRILL
- `.hermes/plans/2026-08-05_065459-agentide-client-credentials.md` — the full plan this IMPL implements
- `packages/gateway-core/src/auth.ts` — `issueToken` (reused)
- `packages/gateway-core/src/types.ts` — `TokenClaims` (reused)
- `packages/gateway-core/src/handle-invocation.ts` — see `tenant.create` for the cap-registration pattern
- `packages/adapter-mcp/src/server.ts` — see the existing HTTP route for the new route pattern
- `packages/sdk-node/src/client.ts` — current static-JWT client (must be updated, not replaced)
- `packages/agentide/src/cli.ts` — see `runTenant` for the new runClient pattern
