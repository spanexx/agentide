import { describe, it, expect } from "vitest";
import { createHash } from "node:crypto";
import { ClientService } from "../client-service.js";
import type { ClientRecord, RegistrationCode } from "../types.js";

const memStore = () => {
  const records: ClientRecord[] = [];
  const codes: RegistrationCode[] = [];
  return {
    store: {
      load: async () => records,
      save: async (r: ClientRecord[]) => { records.length = 0; records.push(...r); },
      loadCodes: async () => codes,
      saveCodes: async (c: RegistrationCode[]) => { codes.length = 0; codes.push(...c); },
    },
    _records: records,
    _codes: codes,
  };
};

describe("ClientService", () => {
  it("createClient returns the secret exactly once and a hashed record", async () => {
    const { store } = memStore();
    const svc = new ClientService(store, () => "salt", () => 1000);
    const { record, plaintextSecret } = await svc.createClient({ tenantId: "acme", name: "n", defaultScope: ["*"] });
    expect(record.id).toMatch(/^cli_/);
    expect(plaintextSecret.length).toBeGreaterThan(20);
    expect(record.hashedSecret).not.toBe(plaintextSecret);
    expect(record.hashedSecret).toMatch(/^sha256:/);
  });
  it("createClient hashes with salt + secret, not just secret", async () => {
    const { store } = memStore();
    const salt = "fixed-salt";
    const svc = new ClientService(store, () => salt, () => 1000);
    const { record, plaintextSecret } = await svc.createClient({ tenantId: "acme", name: "n", defaultScope: ["*"] });
    const digest = createHash("sha256").update(salt + plaintextSecret).digest("hex");
    expect(record.hashedSecret).toBe(`sha256:${salt}:${digest}`);
  });
  it("createClient rate-limits at 5 per hour (6th in 1h -> 429)", async () => {
    const { store } = memStore();
    let t = 1000;
    const svc = new ClientService(store, () => "salt", () => t);
    for (let i = 0; i < 5; i++) {
      await svc.createClient({ tenantId: "acme", name: `n${i}`, defaultScope: ["*"] });
    }
    t += 60_000;
    let threw = false;
    try {
      await svc.createClient({ tenantId: "acme", name: "n6", defaultScope: ["*"] });
    } catch (e) {
      threw = /rate/i.test((e as Error).message);
    }
    expect(threw).toBe(true);
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
    let verified = await svc.verifyClient({ id: record.id, secret: plaintextSecret });
    expect(verified).not.toBeNull();
    t = 2000 + 300_000;
    verified = await svc.verifyClient({ id: record.id, secret: plaintextSecret });
    expect(verified).toBeNull();
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
    t = 1000 + 400_000;
    const result = await svc.redeemRegistrationCode({ code });
    expect(result).toBeNull();
  });
});
