import { describe, expect, it } from "vitest";
import { tokenizeArgs } from "../cli-utils.js";

// CID:shell-014 - tokenizeArgs (surgical fix D-121, 2026-08-09): the shell
// used a raw whitespace split, so quotes reached commands literally —
// `--scope '*'` minted scope ['*'] and `--args '{"a":1}'` failed JSON parse.
// The tokenizer strips quote pairs and groups quoted spaces; no escapes in v1.

describe("tokenizeArgs (shell quote handling, D-121)", () => {
  it("plain words split on whitespace", () => {
    expect(tokenizeArgs("gateway status --json")).toEqual(["gateway", "status", "--json"]);
  });

  it("single quotes are stripped (the --scope '*' bug)", () => {
    expect(tokenizeArgs("token issue --scope '*'")).toEqual(["token", "issue", "--scope", "*"]);
  });

  it("double quotes are stripped", () => {
    expect(tokenizeArgs('--msg "hello world"')).toEqual(["--msg", "hello world"]);
  });

  it("quoted JSON stays ONE argument (the --args bug)", () => {
    expect(tokenizeArgs("invoke cart.add --args '{\"userId\":\"u1\"}'")).toEqual([
      "invoke",
      "cart.add",
      "--args",
      '{"userId":"u1"}',
    ]);
  });

  it("quoted path with spaces becomes one token (cd case)", () => {
    expect(tokenizeArgs("cd 'my dir'")).toEqual(["cd", "my dir"]);
  });

  it("quotes inside a word only strip matched pairs", () => {
    expect(tokenizeArgs("foo'bar'")).toEqual(["foobar"]);
  });

  it("whitespace-only and empty input → []", () => {
    expect(tokenizeArgs("   ")).toEqual([]);
    expect(tokenizeArgs("")).toEqual([]);
  });

  it("unterminated quote throws a friendly error", () => {
    expect(() => tokenizeArgs("--args '{\"a\":1}")).toThrow(/unterminated quote/i);
  });
});
