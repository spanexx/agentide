/*
 * Code Map: POST /oauth/token handler (BI[29] Phase 4)
 * - handleTokenRequest: TLS check -> grant dispatch (client_credentials | registration_code)
 * - TokenRequestRateLimiter: in-memory per-clientId bucket (10 req/min)
 * - auditEmit: token_mint row on every successful client_credentials exchange
 * Owns: HTTP-level concerns (TLS, grant types, error bodies). Does NOT own
 *   secret hashing / storage — delegates to ClientService.
 *
 * CID Index:
 * CID:oauth-001 -> handleTokenRequest
 * CID:oauth-002 -> TokenRequestRateLimiter
 * CID:oauth-003 -> auditEmit (client_credentials.token_mint row)
 *
 * Quick lookup: rg -n "CID:oauth-" packages/gateway-core/src/oauth-token-handler.ts
 */
import type { Clock, YamlValue } from "./types.js";
import { issueToken } from "./auth.js";
import type { ClientService } from "./client-service.js";

// CID:oauth-001 - handleTokenRequest
// Purpose: single entry point for POST /oauth/token. Returns an HTTP
//   status + JSON-able body; never throws.
export interface TokenRequestEnv {
  readonly body: {
    grant_type?: string;
    client_id?: string;
    client_secret?: string;
    code?: string;
    scope?: string;
  };
  readonly clientSvc: ClientService;
  readonly secret: Uint8Array;
  readonly salt: string;
  readonly clock: () => number;
  readonly requireTls: boolean;
  readonly isTls: boolean;
  readonly rateLimiter?: TokenRequestRateLimiter; // injected for tests; default per-call
  readonly auditEmit?: (row: Record<string, string>) => void;
}

export interface TokenResponse {
  readonly status: number;
  readonly body: YamlValue;
}

// Adapter-facing shape: the HTTP adapter knows only body + isTls.
export interface OAuthTokenRequest {
  readonly body: Record<string, string>;
  readonly isTls: boolean;
}
export type OAuthTokenHandler = (req: OAuthTokenRequest) => Promise<TokenResponse>;

export async function handleTokenRequest(env: TokenRequestEnv): Promise<TokenResponse> {
  if (env.requireTls && !env.isTls) {
    return {
      status: 426,
      body: { error: "tls_required", error_description: "POST /oauth/token requires TLS; use --no-tls only for localhost dev" },
    };
  }
  const grant = env.body.grant_type;
  if (grant === "client_credentials") return handleClientCredentialsGrant(env);
  if (grant === "registration_code") return handleRegistrationCodeGrant(env);
  return {
    status: 400,
    body: { error: "unsupported_grant_type", error_description: "only 'client_credentials' and 'registration_code' are supported" },
  };
}

async function handleClientCredentialsGrant(env: TokenRequestEnv): Promise<TokenResponse> {
  const clientId = env.body.client_id ?? "";
  const clientSecret = env.body.client_secret ?? "";
  const limiter = env.rateLimiter ?? new TokenRequestRateLimiter();
  if (!limiter.allow(clientId, env.clock())) {
    return { status: 429, body: { error: "rate_limited", error_description: "10 req/min per clientId; retry after 60s" } };
  }
  const record = await env.clientSvc.verifyClient({ id: clientId, secret: clientSecret });
  if (!record) {
    const rec = await env.clientSvc.findClientById(clientId);
    if (rec?.revoked) {
      return { status: 401, body: { error: "client_revoked", error_description: "operator revoked this client" } };
    }
    return { status: 401, body: { error: "invalid_client", error_description: "client_id or client_secret invalid" } };
  }
  const now = env.clock();
  const claims = {
    sub: { tenantId: record.tenantId, callerId: record.id },
    scope: env.body.scope ? env.body.scope.split(" ") : [...record.defaultScope],
    iat: now,
    exp: now + 3_600_000, // epoch ms, matching TokenClaims elsewhere in gateway-core
  };
  const clock: Clock = { now: () => now, setTimeout: () => 0, clearTimeout: () => {} };
  const token = issueToken(claims, env.secret, clock);
  // CID:oauth-003 - auditEmit
  env.auditEmit?.({
    action: "client_credentials.token_mint",
    client_id: record.id,
    tenant_id: record.tenantId,
    timestamp_utc: new Date(now).toISOString(),
  });
  return { status: 200, body: { access_token: token, token_type: "Bearer", expires_in: 3600 } };
}

async function handleRegistrationCodeGrant(env: TokenRequestEnv): Promise<TokenResponse> {
  const code = env.body.code ?? "";
  const result = await env.clientSvc.redeemRegistrationCode({ code });
  if (!result) {
    return { status: 401, body: { error: "invalid_grant", error_description: "registration code not found, already consumed, or expired" } };
  }
  return { status: 200, body: { client_id: result.clientId, client_secret: result.plaintextSecret } };
}

// CID:oauth-002 - TokenRequestRateLimiter
// Purpose: fixed-window per-clientId counter. Window resets when
//   now - windowStart > windowMs; the (max+1)-th call within a window is denied.
export class TokenRequestRateLimiter {
  private readonly buckets = new Map<string, { count: number; windowStart: number }>();

  constructor(
    private readonly max = 10,
    private readonly windowMs = 60_000,
  ) {}

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
