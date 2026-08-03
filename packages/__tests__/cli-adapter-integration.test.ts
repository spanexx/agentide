/*
 * Cross-language integration test for the cli-adapter `platform` binary.
 * Replaces the Phase-5 stopgap (crates/cli-adapter/tests/e2e.rs +
 * crates/cli-adapter/examples/mock_wire.rs) — the real
 * `@platform/adapter-websocket` IS the canonical W4 WebSocket server
 * (see docs/drift.md D-62 for the prior misclassification), so the e2e
 * layer now drives the same code path as production.
 *
 * Pattern per test: boot a fresh `createWebSocketAdapter` on port 0,
 * mint an HS256 JWT via `issueToken` (test secret), spawn the real
 * `target/debug/platform` binary against it, assert exit code +
 * stdout/stderr. Per-test boot guarantees a free port and a clean
 * pre-auth state — no port collisions, no inter-test event bleed.
 *
 * Exit-code contract (CONTEXT.md 2026-08-03 cli-adapter lock):
 *   0 = invoke.result
 *   2 = pre-flight / connection refused
 *   4 = auth.error / close 1008
 *   (1, 3, 5 covered by Rust unit tests; not asserted here.)
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { createEventBus, type EventBus } from "@platform/event-bus";
import {
  issueToken,
  type CanonicalInvocation,
  type CanonicalResponse,
  type Clock,
  type Gateway,
} from "@platform/gateway-core";
import {
  createWebSocketAdapter,
  type WebSocketAdapter,
} from "@platform/adapter-websocket";

const SECRET = new TextEncoder().encode("integration-test-secret");
const BINARY = resolve(
  __dirname,
  "../../crates/cli-adapter/target/debug/platform",
);
const SPAWN_TIMEOUT_MS = 8_000;

class TestClock implements Clock {
  nowValue = 1_700_000_000_000;
  now(): number { return this.nowValue; }
  setTimeout(cb: () => void, ms: number): number { return setTimeout(cb, ms) as unknown as number; }
  clearTimeout(h: number): void { clearTimeout(h); }
}

function makeToken(clock: TestClock, scope: readonly string[] = ["platform.*.read"]): string {
  return issueToken({
    sub: { tenantId: "acme", callerId: "ops" },
    scope,
    iat: clock.now(),
    exp: clock.now() + 60_000,
  }, SECRET, clock);
}

function makeGateway(): Gateway {
  return {
    listTenants: () => [{ id: "acme", name: "Acme", createdAt: 1, suspended: false }],
    handleInvocation: async (req: CanonicalInvocation): Promise<CanonicalResponse> => {
      return { output: { status: "ok", capability: req.capability.name } };
    },
  } as unknown as Gateway;
}

interface AdapterContext { adapter: WebSocketAdapter; port: number; token: string; }

async function startAdapter(): Promise<AdapterContext> {
  const bus: EventBus = createEventBus();
  const clock = new TestClock();
  const adapter = createWebSocketAdapter(makeGateway(), bus, {
    tokenSecret: SECRET, port: 0, clock,
  });
  await adapter.start();
  const address = adapter.address();
  if (!address) throw new Error("adapter has no address after start()");
  return { adapter, port: address.port, token: makeToken(clock) };
}

interface SpawnResult { exitCode: number | null; stdout: string; stderr: string; }

function spawnBinary(args: string[], env: Record<string, string> = {}): Promise<SpawnResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(BINARY, args, {
      env: { ...process.env, ...env },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill("SIGKILL");
      reject(new Error(`spawn timeout after ${SPAWN_TIMEOUT_MS}ms: ${args.join(" ")}`));
    }, SPAWN_TIMEOUT_MS);
    child.stdout.on("data", (b: Buffer) => { stdout += b.toString(); });
    child.stderr.on("data", (b: Buffer) => { stderr += b.toString(); });
    child.on("error", (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(err);
    });
    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ exitCode: code, stdout, stderr });
    });
  });
}

describe("cli-adapter integration: real binary + real adapter-websocket", () => {
  let ctx: AdapterContext | null = null;

  beforeEach(async () => { ctx = await startAdapter(); });

  afterEach(async () => {
    if (ctx) { await ctx.adapter.stop(); ctx = null; }
  });

  it("capabilities happy path: alias renders a non-empty table → exit 0", async () => {
    const { port, token } = ctx!;
    const r = await spawnBinary(["--url", `ws://127.0.0.1:${port}/ws`, "--token", token, "capabilities"]);
    expect(r.exitCode).toBe(0);
    expect(r.stdout.length).toBeGreaterThan(0);
  });

  it("status happy path: alias renders key:value with ok", async () => {
    const { port, token } = ctx!;
    const r = await spawnBinary(["--url", `ws://127.0.0.1:${port}/ws`, "--token", token, "status"]);
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toMatch(/ok/);
  });

  it("invoke capability.list --json: exit 0, stdout is valid JSON", async () => {
    const { port, token } = ctx!;
    const r = await spawnBinary([
      "--url", `ws://127.0.0.1:${port}/ws`,
      "--token", token,
      "invoke", "capability.list", "--json",
    ]);
    expect(r.exitCode).toBe(0);
    expect(() => JSON.parse(r.stdout) as unknown).not.toThrow();
  });

  it("bad token (wrong secret): exit 4 (auth.error path)", async () => {
    const { port } = ctx!;
    const wrongSecret = new TextEncoder().encode("wrong-secret");
    const bad = issueToken({
      sub: { tenantId: "acme", callerId: "ops" },
      scope: ["platform.*.read"],
      iat: 1_700_000_000_000,
      exp: 1_700_000_000_060_000,
    }, wrongSecret, new TestClock());
    const r = await spawnBinary(["--url", `ws://127.0.0.1:${port}/ws`, "--token", bad, "status"]);
    expect(r.exitCode).toBe(4);
  });

  it("wrong URL (port 1, refused): exit 2 (pre-flight / connection)", async () => {
    const { token } = ctx!;
    const r = await spawnBinary(["--url", "ws://127.0.0.1:1/ws", "--token", token, "status"]);
    expect(r.exitCode).toBe(2);
  });

  it("--url accepted when flag precedes the subcommand", async () => {
    const { port, token } = ctx!;
    const r = await spawnBinary([
      "--url", `ws://127.0.0.1:${port}/ws`,
      "--token", token,
      "capabilities",
    ]);
    expect(r.exitCode).toBe(0);
    expect(r.stdout.length).toBeGreaterThan(0);
  });

  it("aliases: sessions / plugins / health all exit 0", async () => {
    const { port, token } = ctx!;
    for (const alias of ["sessions", "plugins", "health"]) {
      const r = await spawnBinary(["--url", `ws://127.0.0.1:${port}/ws`, "--token", token, alias]);
      expect(r.exitCode, `alias=${alias} (stderr=${r.stderr})`).toBe(0);
    }
  });

  it("missing URL (no flag, no env, no config): exit 2 (usage)", async () => {
    const { token } = ctx!;
    const r = await spawnBinary(["--token", token, "capabilities"], {
      PLATFORM_GATEWAY_URL: "",
      PLATFORM_TOKEN: "",
      HOME: "/tmp/nonexistent-cli-test-home",
      XDG_CONFIG_HOME: "/tmp/nonexistent-cli-test-home/.config",
    });
    expect(r.exitCode).toBe(2);
  });
});
