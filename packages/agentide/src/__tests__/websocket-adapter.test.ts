import { afterEach, describe, expect, it } from "vitest";
import WebSocket from "ws";
import type { FileSystem, YamlValue } from "@spanexx/gateway-core";
import { createPlatform, type Platform } from "../index.js";

class InMemoryFs implements FileSystem {
  files = new Map<string, string>();
  async readFile(path: string): Promise<string> {
    const value = this.files.get(path);
    if (value === undefined) throw new Error(`ENOENT: ${path}`);
    return value;
  }
  async writeFile(path: string, content: string): Promise<void> { this.files.set(path, content); }
  async exists(path: string): Promise<boolean> { return this.files.has(path); }
}

type Frame = { readonly [key: string]: YamlValue };
const platforms: Platform[] = [];

function nextMessage(socket: WebSocket): Promise<Frame> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("message timeout")), 1000);
    socket.once("message", (raw) => {
      clearTimeout(timer);
      resolve(JSON.parse(raw.toString()) as Frame);
    });
  });
}

async function boot(adapterWs?: boolean): Promise<Platform> {
  const platform = await createPlatform({
    fs: new InMemoryFs(),
    dataDir: "/data",
    defaultTenant: { id: "default", name: "Default" },
    adapterMcp: false,
    ...(adapterWs === undefined ? {} : { adapterWs }),
    wsPort: 0,
  });
  platforms.push(platform);
  return platform;
}

afterEach(async () => {
  for (const platform of platforms.splice(0)) await platform.stop();
});

describe("createPlatform WebSocket adapter wiring", () => {
  it("starts the adapter by default and invokes a real platform capability", async () => {
    const platform = await boot();
    const address = platform.wsAdapter?.address();
    expect(address?.port).toBeGreaterThan(0);
    const socket = new WebSocket(`ws://127.0.0.1:${address?.port}/ws`);
    await new Promise<void>((resolve, reject) => {
      socket.once("open", resolve);
      socket.once("error", reject);
    });
    const { token } = await platform.gateway.issueToken({
      tenantId: "default",
      callerId: "ops",
      scope: ["platform.*.read"],
    });
    socket.send(JSON.stringify({ type: "auth", token }));
    expect((await nextMessage(socket)).type).toBe("auth.ok");
    socket.send(JSON.stringify({ type: "invoke", correlationId: "health", name: "system.health" }));
    expect(await nextMessage(socket)).toMatchObject({ type: "invoke.result", correlationId: "health" });
    socket.close();
  });

  it("releases the port during platform stop", async () => {
    const platform = await boot();
    const address = platform.wsAdapter?.address();
    expect(address).not.toBeNull();
    await platform.stop();
    expect(platform.wsAdapter?.address()).toBeNull();
  });

  it("supports explicit adapter opt-out", async () => {
    const platform = await boot(false);
    expect(platform.wsAdapter).toBeUndefined();
    await platform.stop();
  });
});
