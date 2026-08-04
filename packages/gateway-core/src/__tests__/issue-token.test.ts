/*
 * Code Map: mint-side expectedOrigins (origin-bound tokens)
 * - Operator API issueToken: claim minted when requested; [] normalized to absent
 * - Capability auth.token.issue: same minting via handleInvocation
 * - JWT round-trip: claim survives signing + verifyToken; order preserved
 * - Mutation guard: later edits of the request array cannot change the minted claim
 *
 * CID Index:
 * CID:issue-token-001 -> mint when requested
 * CID:issue-token-002 -> absent when omitted / empty
 * CID:issue-token-003 -> JWT round-trip order
 * CID:issue-token-004 -> mutation guard
 * CID:issue-token-005 -> capability handler minting
 */
import { describe, expect, it } from "vitest";
import { createGateway } from "../index.js";
import { issueToken, verifyToken } from "../auth.js";
import type { Clock, FileSystem } from "../index.js";
import { createEventBus } from "@spanexx/event-bus";
import { createCapabilityRegistry } from "@spanexx/capability-registry";
import { createSessionManager } from "@spanexx/session-manager";
import { createPluginManager } from "@spanexx/plugin-manager";

const TEST_SECRET = new TextEncoder().encode("test-secret-key-for-unit-tests-only!!");

class FakeClock implements Clock {
  nowValue = 1_700_000_000_000;
  now(): number { return this.nowValue; }
  setTimeout(): number { return 0; }
  clearTimeout(): void {}
}

class InMemoryFs implements FileSystem {
  files = new Map<string, string>();
  async readFile(path: string): Promise<string> {
    const content = this.files.get(path);
    if (content === undefined) throw new Error(`ENOENT: ${path}`);
    return content;
  }
  async writeFile(path: string, content: string): Promise<void> {
    this.files.set(path, (this.files.get(path) ?? "") + content);
  }
  async exists(path: string): Promise<boolean> {
    return this.files.has(path);
  }
}

async function setup() {
  const fs = new InMemoryFs();
  fs.files.set("/data/gateway-secret", Buffer.from(TEST_SECRET).toString("base64"));
  const clock = new FakeClock();
  const bus = createEventBus();
  const registry = createCapabilityRegistry(bus);
  const sm = createSessionManager(bus, { clock });
  const pm = await createPluginManager(bus, registry, {
    fs,
    clock,
    installRecordPath: "/data/installed-plugins.json",
  });
  const gateway = await createGateway(bus, registry, sm, pm, {
    fs,
    clock,
    auditLogPath: "/data/audit.log",
    tenantsPath: "/data/tenants.json",
    secretPath: "/data/gateway-secret",
  });
  await gateway.createTenant({ id: "default", name: "Default Test Tenant" });
  return { gateway, clock };
}

describe("issueToken expectedOrigins", () => {
  it("CID:issue-token-001 mints expectedOrigins into claims when requested", async () => {
    const { gateway } = await setup();
    const origins = ["https://app.acme.com", "https://*.dev.acme.com"];
    const { claims } = await gateway.issueToken({
      tenantId: "acme",
      callerId: "agent-1",
      scope: ["platform.*.read"],
      expectedOrigins: origins,
    });
    expect(claims.expectedOrigins).toEqual(origins);
  });

  it("CID:issue-token-002 omits the claim when expectedOrigins is not given", async () => {
    const { gateway } = await setup();
    const { token, claims } = await gateway.issueToken({
      tenantId: "acme",
      callerId: "agent-1",
      scope: ["platform.*.read"],
    });
    expect(claims).not.toHaveProperty("expectedOrigins");
    const decoded = JSON.parse(
      Buffer.from(token.split(".")[1], "base64url").toString("utf-8"),
    );
    expect(decoded).not.toHaveProperty("expectedOrigins");
  });

  it("CID:issue-token-002 normalizes an empty array to absent", async () => {
    const { gateway } = await setup();
    const { claims } = await gateway.issueToken({
      tenantId: "acme",
      callerId: "agent-1",
      scope: ["platform.*.read"],
      expectedOrigins: [],
    });
    expect(claims).not.toHaveProperty("expectedOrigins");
  });

  it("CID:issue-token-003 round-trips the claim in exact order through the JWT", async () => {
    const { gateway, clock } = await setup();
    const origins = ["https://b.acme.com", "https://a.acme.com", "https://c.acme.com"];
    const { token } = await gateway.issueToken({
      tenantId: "acme",
      callerId: "agent-1",
      scope: ["platform.*.read"],
      expectedOrigins: origins,
    });
    const verified = verifyToken(token, clock, TEST_SECRET);
    expect(verified.ok).toBe(true);
    if (!verified.ok) return;
    expect(verified.claims.expectedOrigins).toEqual(origins);
  });

  it("CID:issue-token-004 later mutation of the request array cannot change the minted claim", async () => {
    const { gateway } = await setup();
    const req = {
      tenantId: "acme",
      callerId: "agent-1",
      scope: ["platform.*.read"],
      expectedOrigins: ["https://app.acme.com"],
    };
    const { claims } = await gateway.issueToken(req);
    req.expectedOrigins.push("https://evil.example.com");
    expect(claims.expectedOrigins).toEqual(["https://app.acme.com"]);
  });

  it("CID:issue-token-005 auth.token.issue capability mints expectedOrigins from input", async () => {
    const { gateway, clock } = await setup();
    const token = issueToken(
      {
        sub: { tenantId: "default", callerId: "operator" },
        scope: ["*"],
        iat: clock.now(),
        exp: clock.now() + 3_600_000,
      },
      TEST_SECRET,
      clock,
    );
    const res = await gateway.handleInvocation({
      token,
      caller: { tenantId: "default", callerId: "operator", scope: ["*"] },
      sessionId: undefined,
      capability: { name: "auth.token.issue", version: "1.0.0" },
      input: {
        tenantId: "default",
        callerId: "dashboard-bot",
        scope: ["platform.*.read"],
        expectedOrigins: ["https://app.acme.com"],
      },
    });
    expect("output" in res).toBe(true);
    if (!("output" in res)) return;
    const output = res.output as {
      claims: { expectedOrigins?: readonly string[] };
    };
    expect(output.claims.expectedOrigins).toEqual(["https://app.acme.com"]);
  });
});
