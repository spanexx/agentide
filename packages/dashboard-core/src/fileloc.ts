/*
 * Code Map: __filename/__dirname polyfill that survives esbuild's CJS bundle.
 *
 * In a bundled CJS file, `import.meta.url` is undefined (esbuild's
 * `--format=cjs --platform=node` doesn't preserve it). Calling
 * `fileURLToPath(undefined)` throws and the bundle cannot load.
 *
 * This module returns the URL/path of the current file in three modes:
 *   1. ESM unbundled (vitest, node source)  — import.meta.url works
 *   2. CJS bundled (publish)                — CJS __filename works
 *   3. env override (operator-set)          — AGENTIDE_DASHBOARD_ASSETS env
 *
 * CID Index:
 *   CID:util-filename-001 -> resolveFilenameUrl
 *   CID:util-filename-002 -> resolveDirname
 *   CID:util-filename-003 -> resolveAssetsDir
 *
 * Quick lookup: rg -n "CID:util-filename" packages/dashboard-core/src/fileloc.ts
 */

import { fileURLToPath } from "node:url";
import { dirname, isAbsolute, join } from "node:path";
import { existsSync } from "node:fs";

export interface FileLocation {
  // Best-effort URL of the current file (or fallback path).
  readonly url: string;
  // Directory containing the file (or the resolved assets dir).
  readonly dirname: string;
}

function tryImportMeta(): string | undefined {
  try {
    const meta = (import.meta as { url?: string } | undefined);
    return meta?.url;
  } catch {
    return undefined;
  }
}

function tryCjsFilename(): string | undefined {
  // CJS `__filename` global; available in esbuild's --format=cjs bundle.
  // In ESM-only contexts (vitest on a .ts file via the native runner),
  // the global is undefined; we just don't return it.
  const fn = (globalThis as { __filename?: string }).__filename;
  if (typeof fn === "string" && fn.length > 0) return fn;
  return undefined;
}

/**
 * Resolve the URL of the current file. Prefers `import.meta.url` (ESM source /
 * dev), falls back to CJS `__filename` (bundled), then to `process.cwd()`.
 */
export function resolveFilenameUrl(): FileLocation {
  const metaUrl = tryImportMeta();
  if (metaUrl) {
    const dir = dirname(fileURLToPath(metaUrl));
    return { url: metaUrl, dirname: dir };
  }
  const cjsFilename = tryCjsFilename();
  if (cjsFilename) {
    // Synthesize a file:// URL from the CJS filename so callers that need a URL
    // (e.g. `new URL("./assets/index.html", currentUrl)`) still work.
    const url = `file://${cjsFilename}`;
    const dir = dirname(cjsFilename);
    return { url, dirname: dir };
  }
  // Last resort: the cwd. The caller (resolveAssetsDir) uses this only as a
  // baseline, and the existence-check for `assets/index.html` will fail and
  // fall through to the env-override path.
  const cwd = process.cwd();
  return { url: `file://${cwd}`, dirname: cwd };
}

/**
 * Resolve the directory of the current file (without trailing slash).
 */
export function resolveDirname(): string {
  return resolveFilenameUrl().dirname;
}

/**
 * Resolve the assets directory used by the dashboard server. Search order:
 *   1. `AGENTIDE_DASHBOARD_ASSETS` env (operator override; absolute or cwd-relative)
 *   2. <dirname>/assets                        — published: <pkg>/dist/assets/
 *   3. <dirname>/../src/assets                 — source layout
 *   4. <dirname>/../assets                     — built-but-not-bundled
 *   5. cwd                                     — last resort
 *
 * Each candidate must contain `index.html`; otherwise we keep searching.
 * Returns the first match — never `null`, because at minimum we can fall
 * back to the cwd (the server will 500 on `GET /` but the bind still happens).
 */
export function resolveAssetsDir(here: string = resolveDirname()): string {
  const fromEnv = process.env.AGENTIDE_DASHBOARD_ASSETS;
  if (fromEnv && fromEnv.length > 0) {
    const abs = isAbsolute(fromEnv) ? fromEnv : join(process.cwd(), fromEnv);
    return abs;
  }
  const candidates = [
    join(here, "assets"),
    join(here, "..", "src", "assets"),
    join(here, "..", "assets"),
    process.cwd(),
  ];
  for (const c of candidates) {
    try {
      if (existsSync(join(c, "index.html"))) return c;
    } catch {
      // ignore — try next
    }
  }
  return candidates[0];
}