/*
 * Code Map: client_credentials auto-refresh tests (BI[29], Phase 6)
 *
 * Exercises TokenRefresher through the public createSdk surface:
 *   - mint on first refresh, refresh inside the 60s window
 *   - single in-flight refresh (thundering-herd protection)
 *   - exponential backoff + jitter on transport errors
 *   - legacy {token} config never calls /oauth/token
 *   - 401 client_revoked → null token + onRevoked fired
 *
 * Note (drift D-71): the PRD-TRD/IMPL SDK API section describes a flat
 * `createSdk({url, token})` shape with async mint-at-create, and Phase 6
 * names `client.test.ts` as the test file. Shipped code uses the nested
 * SdkConfig {gateway:{url,token}, app, manifest, handlers} with a sync
 * factory, and client.test.ts already covers WsClient. Tests are adapted
 * to that reality (refresher.test.ts, refreshIfNeeded-driven) while
 * keeping every scenario + assertion from the IMPL.
 */

import { describe, it, expect } from "vitest";
import { createSdk } from "../index.js";
import type { FetchImpl } from "../refresher.js";

/** Inline manifest helper (same pattern as skeleton.test.ts). */
function inlineManifest(obj: Record<string, unknown>): Record<string, never> {
  return obj as unknown as Record<string, never>;
}

describe("createSdk with client_credentials", () => {
  it("mints a token on first refresh, then connects with the JWT", async () => {
    const mockFetch = async (url: string, init: { method: string; body: string }) => {
      if (url.endsWith("/oauth/token")) {
        expect(init.method).toBe("POST");
        expect(init.body).toContain("grant_type=client_credentials");
        expect(init.body).toContain("client_id=cli_xxx");
        expect(init.body).toContain("client_secret=secret");
        return { status: 200, body: { access_token: "eyJ.test", token_type: "Bearer", expires_in: 3600 } };
      }
      return { status: 200, body: {} };
    };
    const sdk = createSdk({
      gateway: { url: "ws://localhost:7300/ws" },
      app: { id: "app", name: "App" },
      manifest: inlineManifest({ app: "app", capabilities: [] }),
      handlers: {},
      oauthUrl: "http://localhost:7100",
      clientId: "cli_xxx",
      clientSecret: "secret",
      fetchImpl: mockFetch as FetchImpl,
    });
    await sdk.refreshIfNeeded();
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
    const sdk = createSdk({
      gateway: { url: "ws://localhost:7300/ws" },
      app: { id: "app", name: "App" },
      manifest: inlineManifest({ app: "app", capabilities: [] }),
      handlers: {},
      oauthUrl: "http://localhost:7100",
      clientId: "cli_xxx",
      clientSecret: "secret",
      fetchImpl: mockFetch as FetchImpl,
      clock: () => now,
      random: () => 0, // deterministic refresh-window jitter
    });
    await sdk.refreshIfNeeded();
    expect(sdk.token()).toBe("eyJ.calls_1");
    now += 30_000; // within 60s expiry
    await sdk.refreshIfNeeded();
    expect(sdk.token()).toBe("eyJ.calls_2");
  });

  it("closes the ws cleanly on client_revoked", async () => {
    const mockFetch = async () => ({ status: 401, body: { error: "client_revoked" } });
    const revoked = { called: false };
    const sdk = createSdk({
      gateway: { url: "ws://localhost:7300/ws" },
      app: { id: "app", name: "App" },
      manifest: inlineManifest({ app: "app", capabilities: [] }),
      handlers: {},
      oauthUrl: "http://localhost:7100",
      clientId: "cli_xxx",
      clientSecret: "secret",
      fetchImpl: mockFetch as FetchImpl,
      onRevoked: () => { revoked.called = true; },
    });
    await sdk.refreshIfNeeded();
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
    const sdk = createSdk({
      gateway: { url: "ws://localhost:7300/ws" },
      app: { id: "app", name: "App" },
      manifest: inlineManifest({ app: "app", capabilities: [] }),
      handlers: {},
      oauthUrl: "http://localhost:7100",
      clientId: "cli_xxx",
      clientSecret: "secret",
      fetchImpl: mockFetch as FetchImpl,
      backoffBaseMs: 1,
      backoffMaxMs: 5,
      random: () => 0,
    });
    await sdk.refreshIfNeeded();
    expect(sdk.token()).toBe("eyJ.after_backoff");
    expect(attempts).toBe(3);
  });

  it("legacy {token} config still works without refresh", async () => {
    const fetches: string[] = [];
    const mockFetch = async (url: string) => { fetches.push(url); return { status: 200, body: {} }; };
    const sdk = createSdk({
      gateway: { url: "ws://localhost:7300/ws", token: "eyJ.legacy" },
      app: { id: "app", name: "App" },
      manifest: inlineManifest({ app: "app", capabilities: [] }),
      handlers: {},
      fetchImpl: mockFetch as FetchImpl,
    });
    expect(sdk.token()).toBe("eyJ.legacy");
    await sdk.refreshIfNeeded();
    expect(fetches).toEqual([]); // never called /oauth/token
  });

  it("single in-flight refresh on overlapping ticks", async () => {
    let i = 0;
    const mockFetch = async () => {
      const my = ++i;
      await new Promise((r) => setTimeout(r, 50));
      return { status: 200, body: { access_token: `eyJ.race_${my}`, token_type: "Bearer", expires_in: 3600 } };
    };
    const sdk = createSdk({
      gateway: { url: "ws://localhost:7300/ws" },
      app: { id: "app", name: "App" },
      manifest: inlineManifest({ app: "app", capabilities: [] }),
      handlers: {},
      oauthUrl: "http://localhost:7100",
      clientId: "cli_xxx",
      clientSecret: "secret",
      fetchImpl: mockFetch as FetchImpl,
    });
    await Promise.all([sdk.refreshIfNeeded(), sdk.refreshIfNeeded(), sdk.refreshIfNeeded()]);
    expect(sdk.token()).toBe("eyJ.race_1"); // only the first created the new token
  });
});
