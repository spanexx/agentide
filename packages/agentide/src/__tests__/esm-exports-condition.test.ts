/*
 * Code Map: pin that every published ESM @spanexx package's exports map
 * has a require condition so CJS consumers can `require(@spanexx/X)`
 * and Node ≥ 22.12's native require(esm) handles the rest.
 *
 * Why this exists: drop-cjs-siblings removes the CJS sibling packages
 * (`@spanexx/X-cjs`) that previously let CJS consumers compile and
 * link without issue. With the siblings gone, the ESM package must
 * expose a `require` condition in its exports map so that:
 *   - TypeScript with `module: "node16"` resolves the package at
 *     compile time.
 *   - Node ≥ 22.12's require(esm) resolves at runtime.
 *
 * Without this condition, every CJS consumer (NestJS apps with
 * `module: "commonjs"` or `"node16"`, Express, Fastify) would fail
 * to install or build after the CJS siblings are gone.
 *
 * CID Index:
 * CID:drop-cjs-exports-001 -> every ESM package has a require condition
 * CID:drop-cjs-exports-002 -> require condition points at dist (the compiled ESM)
 */

import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PACKAGES_DIR = path.resolve(HERE, "../../../../packages");

const PUBLISHED_ESM_PACKAGES = [
  "adapter-mcp",
  "adapter-websocket",
  "agentide",
  "backend-runtime",
  "capability-registry",
  "errors",
  "event-bus",
  "gateway-core",
  "origin",
  "platform-capabilities",
  "plugin-manager",
  "sdk-browser",
  "sdk-node",
  "session-manager",
];

describe("ESM exports map (drop-cjs-siblings)", () => {
  it.each(PUBLISHED_ESM_PACKAGES)(
    "CID:drop-cjs-exports-001 — %s exports map has a require condition",
    (pkg) => {
      const pkgJsonPath = path.join(PACKAGES_DIR, pkg, "package.json");
      const j = JSON.parse(fs.readFileSync(pkgJsonPath, "utf-8")) as {
        exports?: unknown;
      };
      expect(j.exports, `${pkg} must declare exports as an object`).toBeTypeOf("object");
      const dot = (j.exports as Record<string, Record<string, unknown>>)["."];
      expect(dot, `${pkg} must have a "." export`).toBeDefined();
      expect(typeof dot["require"], `${pkg} must have a "require" condition in "." exports`).toBe("string");
    },
  );

  it.each(PUBLISHED_ESM_PACKAGES)(
    "CID:drop-cjs-exports-002 — %s require condition points at dist (the compiled ESM output)",
    (pkg) => {
      const pkgJsonPath = path.join(PACKAGES_DIR, pkg, "package.json");
      const j = JSON.parse(fs.readFileSync(pkgJsonPath, "utf-8")) as {
        exports?: unknown;
      };
      const dot = (j.exports as Record<string, Record<string, string>>)["."];
      expect(dot["require"]).toMatch(/dist\//);
      const reqPath = dot["require"];
      const absReq = path.join(PACKAGES_DIR, pkg, reqPath);
      expect(fs.existsSync(absReq), `${pkg}: ${reqPath} must exist after build`).toBe(true);
    },
  );
});
