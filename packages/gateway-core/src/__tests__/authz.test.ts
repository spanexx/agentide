/*
 * Code Map: checkAuthz tests
 * - tier-hierarchy: act covers read, write covers read
 * - namespace wildcard: platform.*.read covers every read-tier platform cap
 * - kind mismatch: platform.*.read does NOT cover runtime.*.read
 * - exact match: business caps
 * - bare wildcard: "*" covers everything
 */

import { describe, it, expect } from "vitest";
import { checkAuthz } from "../authz.js";

describe("checkAuthz — exact match (business caps)", () => {
  it("granted matches required exactly", () => {
    expect(checkAuthz(["app.foo"], ["app.foo"])).toBe(true);
  });

  it("granted does not match required", () => {
    expect(checkAuthz(["app.foo"], ["app.bar"])).toBe(false);
  });

  it("returns true if ANY of required permissions is covered", () => {
    expect(checkAuthz(["app.foo"], ["app.bar", "app.foo"])).toBe(true);
  });
});

describe("checkAuthz — bare wildcard", () => {
  it("'\\*' covers any single required permission", () => {
    expect(checkAuthz(["*"], ["platform.session.write"])).toBe(true);
    expect(checkAuthz(["*"], ["runtime.demo.destructive"])).toBe(true);
    expect(checkAuthz(["*"], ["app.foo"])).toBe(true);
  });
});

describe("checkAuthz — tier hierarchy (runtime)", () => {
  it("act covers read", () => {
    expect(checkAuthz(["runtime.demo.act"], ["runtime.demo.read"])).toBe(true);
  });

  it("destructive covers act and read", () => {
    expect(checkAuthz(["runtime.demo.destructive"], ["runtime.demo.act"])).toBe(true);
    expect(checkAuthz(["runtime.demo.destructive"], ["runtime.demo.read"])).toBe(true);
  });

  it("read does not cover act", () => {
    expect(checkAuthz(["runtime.demo.read"], ["runtime.demo.act"])).toBe(false);
  });

  it("does not cross namespace", () => {
    expect(checkAuthz(["runtime.demo.act"], ["runtime.other.read"])).toBe(false);
  });
});

describe("checkAuthz — tier hierarchy (platform)", () => {
  it("write covers read", () => {
    expect(checkAuthz(["platform.session.write"], ["platform.session.read"])).toBe(true);
  });

  it("read does not cover write", () => {
    expect(checkAuthz(["platform.session.read"], ["platform.session.write"])).toBe(false);
  });

  it("does not cross namespace", () => {
    expect(checkAuthz(["platform.plugin.write"], ["platform.tenant.read"])).toBe(false);
  });
});

describe("checkAuthz — namespace wildcard platform.*.read", () => {
  it("covers platform.session.read", () => {
    expect(checkAuthz(["platform.*.read"], ["platform.session.read"])).toBe(true);
  });

  it("covers platform.tenant.read", () => {
    expect(checkAuthz(["platform.*.read"], ["platform.tenant.read"])).toBe(true);
  });

  it("covers platform.plugin.read", () => {
    expect(checkAuthz(["platform.*.read"], ["platform.plugin.read"])).toBe(true);
  });

  it("covers platform.capability.read", () => {
    expect(checkAuthz(["platform.*.read"], ["platform.capability.read"])).toBe(true);
  });

  it("covers platform.system.read", () => {
    expect(checkAuthz(["platform.*.read"], ["platform.system.read"])).toBe(true);
  });

  it("does NOT cover platform.session.write (rank insufficient)", () => {
    expect(checkAuthz(["platform.*.read"], ["platform.session.write"])).toBe(false);
  });

  it("does NOT cover platform.plugin.write (rank insufficient)", () => {
    expect(checkAuthz(["platform.*.read"], ["platform.plugin.write"])).toBe(false);
  });

  it("does NOT cover runtime.*.read (kind mismatch)", () => {
    expect(checkAuthz(["platform.*.read"], ["runtime.demo.read"])).toBe(false);
  });

  it("does NOT cover app.foo (business cap, exact match only)", () => {
    expect(checkAuthz(["platform.*.read"], ["app.foo"])).toBe(false);
  });
});

describe("checkAuthz — namespace wildcard platform.*.write", () => {
  it("covers platform.plugin.write", () => {
    expect(checkAuthz(["platform.*.write"], ["platform.plugin.write"])).toBe(true);
  });

  it("covers platform.session.write", () => {
    expect(checkAuthz(["platform.*.write"], ["platform.session.write"])).toBe(true);
  });

  it("covers platform.session.read (write covers read)", () => {
    expect(checkAuthz(["platform.*.write"], ["platform.session.read"])).toBe(true);
  });

  it("does NOT cover platform.destructive-write (no such tier)", () => {
    expect(checkAuthz(["platform.*.write"], ["platform.plugin.destructive"])).toBe(false);
  });

  it("does NOT cover runtime.demo.act (kind mismatch)", () => {
    expect(checkAuthz(["platform.*.write"], ["runtime.demo.act"])).toBe(false);
  });
});

describe("checkAuthz — regression: existing platform.* non-wildcard behavior", () => {
  it("platform.plugin.write does NOT cover platform.session.read", () => {
    expect(checkAuthz(["platform.plugin.write"], ["platform.session.read"])).toBe(false);
  });

  it("platform.plugin.write covers platform.plugin.write", () => {
    expect(checkAuthz(["platform.plugin.write"], ["platform.plugin.write"])).toBe(true);
  });
});

describe("checkAuthz — multiple granted scopes", () => {
  it("returns true if any granted covers any required", () => {
    expect(checkAuthz(["platform.session.read", "platform.*.read"], ["platform.tenant.read"])).toBe(true);
  });

  it("returns true if second granted covers first required", () => {
    expect(checkAuthz(["app.foo", "platform.*.write"], ["platform.session.write"])).toBe(true);
  });
});

describe("checkAuthz — empty inputs", () => {
  it("empty caller scope denies anything", () => {
    expect(checkAuthz([], ["platform.session.read"])).toBe(false);
  });

  it("empty required permissions denies (no permissions to check)", () => {
    expect(checkAuthz(["platform.*.read"], [])).toBe(false);
  });
});
