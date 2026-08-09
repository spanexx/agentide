// CID:cli-utils-001 - shared CLI plumbing (cli-restructure split, D-68)
// Purpose: pure helpers with no handler/dispatch dependencies — argv parsing,
//   flag access, result shaping, version resolution, and the tree-derived
//   full help. cli.ts (entry), dispatcher.ts and commands.ts import from
//   here; this module imports only cli-tree + node builtins (no cycles).
import { readFileSync } from "node:fs";
import { resolve as resolvePath } from "node:path";
import { fileURLToPath } from "node:url";
import { GROUPS } from "./cli-tree.js";
import type { CliResult } from "./cli-types.js";

// CID:shell-014 - tokenizeArgs (surgical fix D-121, 2026-08-09): the shell
// previously split lines with /\s+/ so quote characters reached commands
// literally (`--scope '*'` minted scope ["'*'"]; `--args '{"a":1}'` failed
// JSON parse). This tokenizer strips matched single/double quote pairs and
// groups whitespace INSIDE quotes into one argument. No escapes in v1 — an
// unterminated quote is a user error and throws (the shell prints it).
export function tokenizeArgs(line: string): string[] {
  const args: string[] = [];
  let cur = "";
  let quote: string | null = null;
  for (const ch of line) {
    if (quote !== null) {
      if (ch === quote) quote = null;
      else cur += ch;
      continue;
    }
    if (ch === "'" || ch === '"') {
      quote = ch;
      continue;
    }
    if (/\s/.test(ch)) {
      if (cur !== "") {
        args.push(cur);
        cur = "";
      }
      continue;
    }
    cur += ch;
  }
  if (quote !== null) {
    throw new Error(`unterminated quote in shell argument (missing closing ${quote})`);
  }
  if (cur !== "") args.push(cur);
  return args;
}

// CID:cli-version-001 - CLI_VERSION
// Version reported by `agentide --version`. Source of truth = package.json.
// Two paths resolve it:
//   1. esbuild `--define:CLI_VERSION=...` inlines the literal at bundle time
//      (see the `bundle` script in packages/agentide/package.json) — used by
//      the published `dist/bin.bundled.cjs` and the global `agentide` CLI.
//   2. vitest's `define` in vitest.config.ts inlines it for the test suite.
// The plain `tsc`-built dist/index.js and any CJS consumer of
// `@spanexx/agentide` have neither define; the runtime fallback
// (readPackageVersion) guarantees the dist never crashes on
// `CLI_VERSION is not defined`. CID:dist-001 in dist.test.ts pins this.
declare const CLI_VERSION: string;

// CID:cli-version-001 - CJS-bundle-safe package.json lookup.
// In ESM source / dev, `import.meta.url` works. In an esbuild `--format=cjs`
// bundle (the published agentide CLI), `import.meta.url` is undefined and
// `new URL("...", undefined)` throws synchronously, but the outer try/catch
// hides it and we fall through to `0.0.0`. To get the real version, also try
// the CJS __filename global that the bundle exposes.
function resolvePackageJsonCandidates(): string[] {
  const out: string[] = [];
  try {
    const meta = (import.meta as { url?: string } | undefined)?.url;
    if (meta) {
      out.push(new URL("../package.json", meta).toString());       // dist/cli.js → package.json
      out.push(new URL(new URL("./cli.ts", meta).toString(), meta).toString()); // src → package.json
    }
  } catch { /* ESM path threw — fall through */ }
  const cjsFilename = (globalThis as { __filename?: string }).__filename;
  if (typeof cjsFilename === "string" && cjsFilename.length > 0) {
    out.push(`file://${resolvePath(cjsFilename, "..", "..", "package.json")}`);
  }
  return out;
}

let cachedVersion: string | undefined;
function readPackageVersion(): string {
  if (cachedVersion !== undefined) return cachedVersion;
  try {
    for (const url of resolvePackageJsonCandidates()) {
      try {
        // CID:cli-version-002 - convert file:// URL to a real path before
        // reading. readFileSync on a file:// URL throws ENOENT on
        // older Node and is unreliable across versions; fileURLToPath
        // gives us a stable absolute path on all supported Node versions.
        const path = url.startsWith("file://") ? fileURLToPath(url) : url;
        const raw = readFileSync(path, "utf-8") as string;
        const pkg = JSON.parse(raw) as { version?: string };
        if (typeof pkg.version === "string") {
          cachedVersion = pkg.version;
          return cachedVersion;
        }
      } catch {
        // try next candidate
      }
    }
    cachedVersion = "0.0.0";
  } catch {
    cachedVersion = "0.0.0";
  }
  return cachedVersion;
}

export function cliVersion(): string {
  // When esbuild or vitest defines CLI_VERSION, the const is a real string.
  // The `declare const` is TypeScript-only; at runtime it is undeclared
  // unless the defines above substitute a literal. `typeof` short-circuits
  // on the undeclared-symbol case so we never throw ReferenceError when the
  // dist is loaded by raw Node.
  return typeof CLI_VERSION === "string" && CLI_VERSION !== ""
    ? CLI_VERSION
    : readPackageVersion();
}

// CID:cli-tree-015 - buildHelp (IMPL Phase 3, PRD-TRD S3)
// Purpose: full help for bare/--help. The Usage block is derived from the
//   GROUPS tree (single source of truth — a tree edit shows up here). The
//   remote section + deprecated line keep the legacy aliases visible during
//   the one-release migration window (PRD-TRD S4); they die with the old
//   names in the release after this one.
export function buildHelp(): string {
  const groupLines = Object.keys(GROUPS)
    .map((g) => `  agentide ${g.padEnd(10)} ${Object.keys(GROUPS[g]!.subs).join("|")}`)
    .join("\n");
  return `agentide (v${cliVersion()}) — Agent Runtime Platform operator CLI

Usage:
  agentide init     [--data-dir <path>] [--default-tenant <id>] [--default-tenant-name <name>]
${groupLines}
  agentide invoke   <capability> [--args '<json>'] [--session <id>] [--mode call|stream]
  agentide watch    <alias> [--topic <pattern>]

Run 'agentide <group>' for a group's subcommands; 'agentide <group> <sub> --help' for flags.

Remote (live gateway over websocket — needs --url/PLATFORM_GATEWAY_URL or config file):
  agentide sessions            # session.list alias
  agentide capabilities        # capability.list alias
  agentide plugins             # plugin.list alias
  agentide status              # gateway.status alias (remote when --url present)
  agentide health              # system.health alias
  agentide invoke <cap> [--args '<json>'] [--session <id>] [--mode call|stream]
  agentide watch <alias> [--topic <pattern>]

  common flags: --url <ws://host/ws> --token <jwt|path:/...> --json --data-dir <path>
  config: <OS-config-dir>/platform/config.toml (override: --config <path>)

Deprecated (removed next release): agentide start, agentide stop, agentide status, agentide health, agentide sessions, agentide capabilities, agentide plugins
`;
}

export interface ParsedArgs {
  positional: string[];
  flags: Record<string, string | boolean | string[]>;
}

export function parseArgs(argv: readonly string[]): ParsedArgs {
  const positional: string[] = [];
  const flags: Record<string, string | boolean | string[]> = {};
  let i = 0;
  while (i < argv.length) {
    const tok = argv[i];
    if (tok === undefined) break;
    if (tok.startsWith("--")) {
      // Split on '=' so `--flag=value` parses to { flag: "value" } (matches
      // the convention used by --port-sdk, --port-mcp, --bind, etc.). When
      // the parser was first written, only `--flag value` was supported and
      // `--flag=value` silently became a key with `=value` baked in — that
      // hid flag bugs in CI. CID:cli-args-001.
      const eq = tok.indexOf("=");
      const key = eq >= 0 ? tok.slice(2, eq) : tok.slice(2);
      const inlineValue = eq >= 0 ? tok.slice(eq + 1) : undefined;
      if (inlineValue !== undefined) {
        // `--flag=value` — record the value directly, do not consume argv[i+1].
        const existing = flags[key];
        if (typeof existing === "string") {
          flags[key] = [existing, inlineValue];
        } else if (Array.isArray(existing)) {
          existing.push(inlineValue);
        } else {
          flags[key] = inlineValue;
        }
        i += 1;
        continue;
      }
      const next = argv[i + 1];
      if (next === undefined || next.startsWith("--")) {
        flags[key] = true;
        i += 1;
      } else {
        const existing = flags[key];
        if (typeof existing === "string") {
          flags[key] = [existing, next];
        } else if (Array.isArray(existing)) {
          existing.push(next);
        } else {
          flags[key] = next;
        }
        i += 2;
      }
    } else {
      positional.push(tok);
      i += 1;
    }
  }
  return { positional, flags };
}

export function getFlag(flags: Record<string, string | boolean | string[]>, key: string, fallback: string): string {
  const v = flags[key];
  if (Array.isArray(v)) return v[v.length - 1];
  return typeof v === "string" ? v : fallback;
}

export function getFlagAll(flags: Record<string, string | boolean | string[]>, key: string): string[] {
  const v = flags[key];
  if (Array.isArray(v)) return [...v];
  return typeof v === "string" ? [v] : [];
}

export function result(stdout: string, stderr = "", exitCode = 0): CliResult {
  return { exitCode, stdout, stderr };
}
