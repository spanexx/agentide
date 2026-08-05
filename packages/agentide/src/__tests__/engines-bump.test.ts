/*
 * Code Map: pin that every published ESM @spanexx package declares
 * engines.node: ">=22.12" so the require-condition published in
 * Phase 1a is documented as the supported floor.
 *
 * Drop-cjs-siblings removed the CJS sibling packages. For that
 * drop to be safe at the npm-install layer, every ESM package
 * must require Node >= 22.12 — that's the version where
 * require(esm) became stable, so a NestJS / Express / Fastify
 * consumer with module: commonjs or nodenext can compile
 * against a single ESM package.
 *
 * Without this engines bump, a Node 20 host can install the ESM
 * package, fail at runtime with ESM-resolution errors, and have
 * nothing on npm to fall back to. We refuse the install at the
 * gate instead.
 *
 * CID Index:
 * CID:engines-bump-001 -> every published ESM package requires Node >= 22.12
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

describe("engines bump (drop-cjs-siblings)", () => {
  it.each(PUBLISHED_ESM_PACKAGES)(
    "CID:engines-bump-001 — %s declares engines.node >= 22.12",
    (pkg) => {
      const pkgJsonPath = path.join(PACKAGES_DIR, pkg, "package.json");
      const j = JSON.parse(fs.readFileSync(pkgJsonPath, "utf-8")) as {
        engines?: { node?: string };
      };
      expect(j.engines, `${pkg} must have an engines field`).toBeDefined();
      expect(j.engines?.node, `${pkg} engines.node must be ">=22.12"`).toBe(">=22.12");
    },
  );

  it("CID:engines-bump-002 — root package.json engines.node >= 22.12", () => {
    const rootPkg = path.resolve(PACKAGES_DIR, "..", "package.json");
    const j = JSON.parse(fs.readFileSync(rootPkg, "utf-8")) as {
      engines?: { node?: string };
    };
    expect(j.engines?.node).toBe(">=22.12");
  });
});
