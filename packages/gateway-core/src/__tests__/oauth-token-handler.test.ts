/*
 * Code Map: POST /oauth/token handler tests (BI[29] Phase 4)
 * - TLS enforcement: 426 tls_required when requireTls=true + plain HTTP
 * - client_credentials grant: 200 + JWT, 401 invalid_client, 401 client_revoked
 * - registration_code grant: 401 invalid_grant on bad/consumed codes
 * - 429 rate_limited after 10 req/min per clientId
 *
 * CID Index:
 * CID:oauth-001 -> handleTokenRequest (9 scenarios)
 * CID:oauth-002 -> TokenRequestRateLimiter (429 test)
 * CID:oauth-003 -> auditEmit (token_mint row, via assertion-less hook)
 */
import { describe, it, expect } from "vitest";
import { handleTokenRequest, TokenRequestRateLimiter } from "../oauth-token-handler.js";
import { ClientService } from "../client-service.js";

const buildEnv = async () => {
  const secretBytes = new Uint8Array(32);
  const salt = "deadbeef";
  const clients: Array<Record<string, unknown>> = [];
  const codes: Array<Record<string, unknown>> = [];
  const store = {
    load: async () => clients,
    save: async (r: readonly Record<string, unknown>[]) => {
      clients.length = 0;
      clients.push(...r);
    },
    loadCodes: async () => codes,
    saveCodes: async (c: readonly Record<string, unknown>[]) => {
      codes.length = 0;
      codes.push(...c);
    },
  };
  const clientSvc = new ClientService(store as never, () => salt, () => 1000);
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
    const body = result.body as { access_token: string; token_type: string; expires_in: number };
    expect(body.access_token).toMatch(/^eyJ/);
    expect(body.token_type).toBe("Bearer");
    expect(body.expires_in).toBe(3600);
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
    const limiter = new TokenRequestRateLimiter();
    const handler = async () => handleTokenRequest({
      body: { grant_type: "client_credentials", client_id: env.record.id, client_secret: env.plaintextSecret },
      clientSvc: env.clientSvc, secret: env.secretBytes, salt: env.salt, clock, requireTls: false, isTls: true,
      rateLimiter: limiter,
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

  it("audits a token_mint row on successful client_credentials (CID:oauth-003)", async () => {
    const env = await buildEnv();
    const rows: Array<Record<string, string>> = [];
    const result = await handleTokenRequest({
      body: { grant_type: "client_credentials", client_id: env.record.id, client_secret: env.plaintextSecret },
      clientSvc: env.clientSvc, secret: env.secretBytes, salt: env.salt, clock: () => 1000,
      requireTls: false, isTls: true,
      auditEmit: (row) => rows.push(row),
    });
    expect(result.status).toBe(200);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.action).toBe("client_credentials.token_mint");
    expect(rows[0]?.client_id).toBe(env.record.id);
  });

  it("TokenRequestRateLimiter resets after the window elapses (CID:oauth-002)", () => {
    const limiter = new TokenRequestRateLimiter(2, 60_000);
    expect(limiter.allow("cli_a", 1000)).toBe(true);
    expect(limiter.allow("cli_a", 2000)).toBe(true);
    expect(limiter.allow("cli_a", 3000)).toBe(false);
    // window reset
    expect(limiter.allow("cli_a", 1000 + 60_001)).toBe(true);
  });
});
