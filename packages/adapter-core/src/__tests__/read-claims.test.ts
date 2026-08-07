import { describe, expect, it } from "vitest";
import { readClaims } from "../read-claims.js";

function makeToken(payload: object): string {
  const b64 = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `header.${b64}.sig`;
}

describe("readClaims", () => {
  it("reads scope from a well-formed token", () => {
    const claims = readClaims(makeToken({ scope: ["product.list", "order.create"] }));
    expect(claims.scope).toEqual(["product.list", "order.create"]);
  });

  it("returns [] scope when scope claim is absent", () => {
    const claims = readClaims(makeToken({ sub: "u1" }));
    expect(claims.scope).toEqual([]);
  });

  it("returns [] scope when scope claim is not an array", () => {
    expect(readClaims(makeToken({ scope: "product.list" })).scope).toEqual([]);
    expect(readClaims(makeToken({ scope: 42 })).scope).toEqual([]);
  });

  it("filters non-string entries out of scope", () => {
    const claims = readClaims(makeToken({ scope: ["product.list", 7, null, true] }));
    expect(claims.scope).toEqual(["product.list"]);
  });

  it("returns empty claims for a token with no payload segment", () => {
    expect(readClaims("just-one-part")).toEqual({ scope: [], payload: {} });
  });

  it("returns empty claims for malformed base64url payload", () => {
    // "%%%" is not valid base64url; Buffer.from(base64url) would throw on decode
    const bad = `header.${"%%%not-base64%%%"}.sig`;
    expect(readClaims(bad)).toEqual({ scope: [], payload: {} });
  });

  it("returns empty claims for non-object payload JSON", () => {
    const tok = makeToken("just a string" as unknown as object);
    // makeToken JSON-stringifies, so craft a raw scalar payload directly
    const raw = `header.${Buffer.from('"scalar"').toString("base64url")}.sig`;
    expect(readClaims(raw)).toEqual({ scope: [], payload: {} });
  });

  it("preserves the full payload for downstream consumers", () => {
    const claims = readClaims(makeToken({ sub: "u1", scope: ["a"], exp: 123 }));
    expect(claims.payload).toEqual({ sub: "u1", scope: ["a"], exp: 123 });
  });
});
