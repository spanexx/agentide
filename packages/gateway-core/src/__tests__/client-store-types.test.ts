import { describe, it, expect } from "vitest";
import type { ClientRecord, RegistrationCode, ClientStore } from "../types.js";

describe("client types", () => {
  it("ClientRecord has the required fields", () => {
    const rec: ClientRecord = {
      id: "cli_abc", tenantId: "acme", name: "n", hashedSecret: "sha256:xx",
      defaultScope: ["*"], revoked: false, createdAt: 1,
      lastUsedAt: null, lastRotatedAt: null, gracePeriodEndsAt: null,
    };
    expect(rec.id).toBe("cli_abc");
  });
  it("RegistrationCode has the required fields", () => {
    const c: RegistrationCode = {
      code: "rc_xxx", tenantId: "acme", defaultScope: ["*"],
      expiresAt: 999999, consumed: false,
    };
    expect(c.code).toMatch(/^rc_/);
  });
  it("ClientStore interface declares load/save for both", () => {
    type _Loads = ClientStore["load"];
    type _Saves = ClientStore["save"];
    expect(true).toBe(true);
  });
});
