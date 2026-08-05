/*
 * Code Map: TokenRefresher — client_credentials token lifecycle (BI[29], Phase 6)
 *
 * Owns the JWT mint + refresh loop for SDKs that authenticate with
 * clientId/clientSecret instead of a static token:
 *   - POST {oauthUrl}/oauth/token with grant_type=client_credentials
 *   - refresh when exp < 60s + jitter (Math.random() * 30_000 ms) so 1000
 *     clients don't all refresh at the same wall-clock minute
 *   - single in-flight refresh (thundering-herd protection)
 *   - exponential backoff + jitter on transport errors
 *   - on 401 {error:"client_revoked"}: null the token, fire onRevoked,
 *     stop retrying
 *
 * Test seams: fetchImpl, clock, random are injectable. Defaults follow the
 * runtime (globalThis.fetch / Date.now / Math.random).
 *
 * CID Index:
 * CID:sdk-001 -> TokenRefresher (this class)
 *
 * Quick lookup: rg -n "CID:sdk-" packages/sdk-node/src/refresher.ts
 */

/** Recursive JSON value (replaces banned `unknown` outside catch clauses). */
export type JsonValue =
  | string
  | number
  | boolean
  | null
  | readonly JsonValue[]
  | { readonly [key: string]: JsonValue };

/** Narrow a JsonValue to its object member (property access on the union is not allowed). */
function asRecord(value: JsonValue): { readonly [key: string]: JsonValue } | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
  return value as { readonly [key: string]: JsonValue };
}

/** Minimal fetch seam. Accepts either a plain {status, body} object (tests)
 *  or a Response-like {status, json()} (real fetch).
 */
export type FetchImpl = (
  url: string,
  init: { readonly method: string; readonly body: string; readonly headers: Record<string, string> },
) => Promise<{ status: number; body?: JsonValue } | { status: number; json(): Promise<JsonValue> }>;

export interface TokenRefresherConfig {
  readonly oauthUrl: string;
  readonly clientId: string;
  readonly clientSecret: string;
  readonly fetchImpl?: FetchImpl;
  /** Epoch ms. Default Date.now. */
  readonly clock?: () => number;
  /** [0,1) jitter source. Default Math.random. */
  readonly random?: () => number;
  readonly backoffBaseMs?: number;
  readonly backoffMaxMs?: number;
  readonly maxAttempts?: number;
  readonly onRevoked?: () => void;
}

const REFRESH_WINDOW_MS = 60_000;
const REFRESH_JITTER_MS = 30_000;
const DEFAULT_EXPIRES_IN_S = 3600;

// CID:sdk-001 - TokenRefresher
export class TokenRefresher {
  private readonly oauthUrl: string;
  private readonly clientId: string;
  private readonly clientSecret: string;
  private readonly fetchImpl: FetchImpl;
  private readonly clock: () => number;
  private readonly random: () => number;
  private readonly backoffBaseMs: number;
  private readonly backoffMaxMs: number;
  private readonly maxAttempts: number;
  private readonly onRevoked?: () => void;

  private tokenValue: string | null = null;
  private expiresAtMs = 0;
  private inFlightPromise: Promise<string | null> | null = null;
  private revokedFlag = false;
  private attempts = 0;

  constructor(config: TokenRefresherConfig) {
    this.oauthUrl = config.oauthUrl;
    this.clientId = config.clientId;
    this.clientSecret = config.clientSecret;
    this.fetchImpl = config.fetchImpl ?? ((url, init) => fetch(url, init).then(async (res) => ({ status: res.status, json: async () => (await res.json()) as JsonValue })));
    this.clock = config.clock ?? Date.now;
    this.random = config.random ?? Math.random;
    this.backoffBaseMs = config.backoffBaseMs ?? 1_000;
    this.backoffMaxMs = config.backoffMaxMs ?? 30_000;
    this.maxAttempts = config.maxAttempts ?? 5;
    this.onRevoked = config.onRevoked;
  }

  /** Current JWT, or null when none minted yet / client revoked. */
  token(): string | null {
    return this.tokenValue;
  }

  isRevoked(): boolean {
    return this.revokedFlag;
  }

  /** Mint the first token when none is held. Awaits any in-flight request. */
  async ensureToken(): Promise<string | null> {
    if (this.tokenValue !== null) return this.tokenValue;
    if (this.revokedFlag) return null;
    return this.refreshWithLock();
  }

  /**
   * Refresh when the JWT is inside the refresh window (exp < 60s + jitter),
   * or mint when no token is held yet. Single in-flight refresh — concurrent
   * callers share the same request.
   */
  async refreshIfNeeded(): Promise<void> {
    if (this.revokedFlag) return;
    if (this.inFlightPromise !== null) {
      await this.inFlightPromise;
      return;
    }
    const now = this.clock();
    const jitteredWindow = REFRESH_WINDOW_MS + this.random() * REFRESH_JITTER_MS;
    if (this.tokenValue !== null && now + jitteredWindow < this.expiresAtMs) {
      return; // still fresh
    }
    await this.refreshWithLock();
  }

  private refreshWithLock(): Promise<string | null> {
    if (this.inFlightPromise !== null) return this.inFlightPromise;
    this.inFlightPromise = this.refreshNow().finally(() => {
      this.inFlightPromise = null;
    });
    return this.inFlightPromise;
  }

  /** POST /oauth/token with exponential backoff on transport errors. */
  private async refreshNow(): Promise<string | null> {
    for (;;) {
      if (this.revokedFlag) return null;
      try {
        const res = await this.fetchImpl(`${this.oauthUrl}/oauth/token`, {
          method: "POST",
          body:
            `grant_type=client_credentials&client_id=${encodeURIComponent(this.clientId)}` +
            `&client_secret=${encodeURIComponent(this.clientSecret)}`,
          headers: { "content-type": "application/x-www-form-urlencoded" },
        });
        const rawBody = "json" in res ? await res.json() : (res.body ?? {});
        const body = asRecord(rawBody) ?? {};
        if (body.error === "client_revoked" && res.status === 401) {
          // CID:sdk-001 - revocation: null the token, fire the callback,
          // stop retrying. The SDK's connect loop is blocked by the caller.
          this.revokedFlag = true;
          this.tokenValue = null;
          this.onRevoked?.();
          return null;
        }
        if (res.status !== 200) {
          throw new Error(`oauth token endpoint returned HTTP ${res.status}`);
        }
        const accessToken = typeof body.access_token === "string" ? body.access_token : null;
        if (accessToken === null) {
          throw new Error("oauth token endpoint returned no access_token");
        }
        const expiresIn = typeof body.expires_in === "number" ? body.expires_in : DEFAULT_EXPIRES_IN_S;
        this.tokenValue = accessToken;
        this.expiresAtMs = this.clock() + expiresIn * 1000;
        this.attempts = 0;
        return accessToken;
      } catch (e) {
        // Transport error (ECONNREFUSED etc.) or protocol error — backoff and retry.
        this.attempts += 1;
        if (this.attempts >= this.maxAttempts) {
          throw e instanceof Error ? e : new Error(String(e));
        }
        await this.backoff();
      }
    }
  }

  private backoff(): Promise<void> {
    const raw = this.backoffBaseMs * 2 ** (this.attempts - 1);
    const cap = Math.min(raw, this.backoffMaxMs);
    const delay = cap + this.random() * cap;
    return new Promise((resolve) => {
      setTimeout(resolve, delay);
    });
  }
}
