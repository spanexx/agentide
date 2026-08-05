/*
 * Code Map: cross-repo guard rail for the drop-cjs-siblings pack.
 *
 * The example app's `src/platform/platform.agent.ts` must import
 * the ESM SDK (`@spanexx/sdk-node`), not the CJS sibling
 * (`@spanexx/sdk-node-cjs`). When the CJS siblings are gone from
 * source control and npm, the example's import line is a pure
 * compile-time dependency on this naming choice. Drift here means
 * the example silently reinstalls a stale version or fails npm
 * install entirely. This test pins the source-level invariant so
 * a future agent can't silently regress it.
 *
 * CID Index:
 * CID:drop-cjs-001 -> example imports ESM SDK, not CJS sibling
 */

import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const EXAMPLE_PLATFORM_AGENT = path.resolve(
  HERE,
  "../../../../..",
  "example/src/platform/platform.agent.ts",
);

describe("example app imports (drop-cjs-siblings)", () => {
  it("CID:drop-cjs-001 — example/src/platform/platform.agent.ts imports the ESM SDK, not the CJS sibling", () => {
    const src = fs.readFileSync(EXAMPLE_PLATFORM_AGENT, "utf-8");
    // No `@spanexx/*-cjs` import line.
    expect(src).not.toMatch(/from\s+['"]@spanexx\/[a-z-]+-cjs['"]/);
    expect(src).not.toMatch(/from\s+['"]@spanexx\/sdk-node-cjs['"]/);
    expect(src).not.toMatch(/from\s+['"]@spanexx\/event-bus-cjs['"]/);
    // The ESM SDK import is present.
    expect(src).toMatch(/from\s+['"]@spanexx\/sdk-node['"]/);
  });
});
