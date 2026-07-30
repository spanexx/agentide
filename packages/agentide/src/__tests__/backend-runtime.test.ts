import { describe, expect, it, afterEach } from "vitest";
import WebSocket from "ws";
import { createPlatform } from "../index.js";
import type { FileSystem } from "@platform/gateway-core";
import type { Platform } from "../types.js";

class InMemoryFs implements FileSystem {
  files = new Map<string, string>();
  async readFile(path: string): Promise<string> {
    const v = this.files.get(path);
    if (v === undefined) {
      const err = new Error(`ENOENT: ${path}`) as NodeJS.ErrnoException;
      err.code = "ENOENT";
      throw err;
    }
    return v;
  }
  async writeFile(path: string, content: string): Promise<void> {
    this.files.set(path, content);
  }
  async exists(path: string): Promise<boolean> {
    return this.files.has(path);
  }
}

describe("createPlatform + BackendRuntime integration", () => {
  const platforms: Array<{ stop: () => Promise<void> }> = [];
  const clients: WebSocket[] = [];

  function trackPlatform(p: Platform): Platform {
    platforms.push(p);
    return p;
  }

  afterEach(async () => {
    for (const c of clients) {
      try {
        if (c.readyState === WebSocket.OPEN) c.close();
      } catch {
        // ignore
      }
    }
    clients.length = 0;
    for (const p of platforms) {
      try {
        await p.stop();
      } catch {
        // ignore
      }
    }
    platforms.length = 0;
  });

  it("end-to-end: SDK connects, registers a cap, gateway invokes, SDK replies, result returns", async () => {
    const fs = new InMemoryFs();
    const platform = trackPlatform(
      await createPlatform({
        fs,
        dataDir: "/data",
        defaultTenant: { id: "default", name: "Default" },
        backendRuntimePort: 0, // OS-assigned
      }),
    );

    // BackendRuntime must exist on the platform
    expect(platform.backendRuntime).toBeDefined();
    const addr = platform.backendRuntime?.address();
    expect(addr).not.toBeNull();
    const port = addr?.port;
    expect(typeof port).toBe("number");

    // Mint a token that the SDK will present during the auth handshake.
    // The token's sub.callerId becomes the SDK's appId.
    const { token } = await platform.gateway.issueToken({
      tenantId: "default",
      callerId: "demo-app",
      scope: ["*"],
    });

    // Connect a fake SDK client.
    const ws = new WebSocket(`ws://127.0.0.1:${port}`);
    clients.push(ws);
    await new Promise<void>((resolve, reject) => {
      ws.once("open", () => resolve());
      ws.once("error", (e) => reject(e));
    });

    // Send sdk.auth.
    ws.send(JSON.stringify({ type: "sdk.auth", token }));
    // Send one sdk.capability.register.
    ws.send(
      JSON.stringify({
        type: "sdk.capability.register",
        name: "demo.greet",
        description: "Returns a greeting",
        version: "1.0.0",
        permissions: "demo.read",
        tier: "",
      }),
    );

    // Wait for the cap to land in the registry.
    const start = Date.now();
    while (Date.now() - start < 2000) {
      const r = platform.capabilityRegistry.describe("demo.greet");
      if (r.capability !== null) break;
      await new Promise((r) => setTimeout(r, 10));
    }
    expect(platform.capabilityRegistry.describe("demo.greet").capability).not.toBeNull();

    // Wire up the SDK to reply to any sdk.invoke with a greeting payload.
    ws.on("message", (raw) => {
      const msg = JSON.parse(raw.toString());
      if (msg.type !== "sdk.invoke") return;
      ws.send(
        JSON.stringify({
          type: "sdk.invoke.result",
          callId: msg.callId,
          payload: { greeting: "hello from the SDK" },
        }),
      );
    });

    // Business caps require an active session (handle-invocation.ts
    // SESSION_LESS_CAPABILITIES only lists platform caps). Create one
    // through the gateway's session.create capability — exercises the
    // session-manager integration alongside the SDK dispatch.
    const { output: sessionOutput } = (await platform.gateway.handleInvocation({
      token,
      capability: { name: "session.create" },
      input: { ownerId: "tester", adapterType: "mcp" },
    })) as { output: { id: string } };
    const sessionId = sessionOutput.id;

    // Gateway-side invocation against the SDK-registered cap. Use the
    // token + sessionId so the SESSION_LESS_CAPABILITIES check passes.
    const result = await platform.gateway.handleInvocation({
      token,
      sessionId,
      capability: { name: "demo.greet" },
      input: { who: "tester" },
    });

    // Diagnostic throw: if the result has an error, surface its details so the
    // test failure message tells us WHY dispatch failed (e.g., token expired,
    // scope denied, runtime unreachable). If it's an output, check the value.
    if (!("output" in result)) {
      type ErrResult = { error: { code: string; message: string; details: Record<string, unknown>; retryable: boolean } };
      const err = result as ErrResult;
      throw new Error(
        `expected output, got error: code=${err.error?.code} message=${err.error?.message} retryable=${err.error?.retryable} details=${JSON.stringify(err.error?.details)}`,
      );
    }
    expect(result.output).toEqual({ greeting: "hello from the SDK" });
  });

  it("platform.stop() closes the BackendRuntime WebSocket server cleanly", async () => {
    const fs = new InMemoryFs();
    const platform = trackPlatform(
      await createPlatform({
        fs,
        dataDir: "/data",
        defaultTenant: { id: "default", name: "Default" },
        backendRuntimePort: 0,
      }),
    );
    const addr = platform.backendRuntime?.address();
    expect(addr).not.toBeNull();

    // After stop, the address should reset to null on the runtime.
    await platform.stop();
    expect(platform.backendRuntime?.address()).toBeNull();

    // Trying to connect after stop should fail (server is closed).
    const ws = new WebSocket(`ws://127.0.0.1:${addr!.port}`);
    clients.push(ws);
    const connectFailed = await new Promise<boolean>((resolve) => {
      ws.once("open", () => resolve(false));
      ws.once("error", () => resolve(true));
    });
    expect(connectFailed).toBe(true);
  });
});