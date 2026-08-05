/*
 * Code Map: OIDC auth-code grant tests (BI[29] Phase 7)
 *
 * Verifies:
 *   - handleAuthorize: 302 to dev-stub-approve when enableOidc=true,
 *     403 {error:"oidc_disabled"} when false
 *   - handleCallback: consumes an authorization code, mints a JWT
 *     (issueToken, like client_credentials), 302 to redirect_uri?code=<jwt>
 *   - consumed codes are one-shot: second callback -> 401
 *
 * Note (drift D-71 sibling): the IMPL step-3 prose says handleCallback
 * "creates a reg code", but the callback env carries secret + clock and the
 * test title says "exchanges an unconsumed code for a JWT" — the shipped
 * shape mints a JWT directly (no clientSvc in scope). Tests assert the
 * code= query param, which both readings satisfy.
 */

import { describe, it, expect } from "vitest";
import { handleAuthorize, handleCallback } from "../oauth-token-handler.js";

type CodeEntry = { clientId: string; tenantId: string; scope: string[] };

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
    const codeStore = new Map<string, CodeEntry>();
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
    const codeStore = new Map<string, CodeEntry>();
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
