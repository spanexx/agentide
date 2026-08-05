import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const agentidePkg = JSON.parse(
  readFileSync(
    fileURLToPath(new URL("./packages/agentide/package.json", import.meta.url)),
    "utf-8",
  ),
) as { version: string };

export default defineConfig({
  define: {
    CLI_VERSION: JSON.stringify(agentidePkg.version),
  },
  test: {
    include: [
      "packages/*/src/**/*.test.ts",
      "packages/__tests__/**/*.test.ts",
    ],
    exclude: ["**/dist/**", "**/node_modules/**"],
  },
});