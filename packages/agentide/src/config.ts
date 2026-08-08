// CID:config-001 - resolveConfig
// Purpose: flag > env > config file > prompt (TTY only) precedence tree for
//   gateway URL + token. `path:/...` token indirection (read file once per
//   run). Perms warning for config/token files looser than 0600 (exactly ONE
//   stderr warning per run — S6).
// Used by: cli.ts (remote commands), consumer.ts
import { readFileSync, statSync, mkdirSync, writeFileSync, chmodSync, renameSync } from "node:fs";
import { isatty } from "node:tty";
import { homedir } from "node:os";
import { resolve, dirname, isAbsolute } from "node:path";
import * as readline from "node:readline";

export enum Source {
  Flag = "flag",
  Env = "env",
  ConfigFile = "config-file",
  Prompt = "prompt",
}

export interface ResolvedConfig {
  url: string;
  token: string;
  tokenSource: Source;
  urlSource: Source;
  warnings: string[]; // stderr warnings (S6: perms)
}

export interface ResolveConfigOptions {
  argv: readonly string[];
  env: NodeJS.ProcessEnv;
  isTTY?: boolean;
  cwd?: string;
  home?: string;
}

export class ConfigError extends Error {
  readonly exitCode: number;
  constructor(message: string, exitCode = 2) {
    super(message);
    this.exitCode = exitCode;
  }
}

// parse --flag values (same GNU-ish convention as cli.ts parseArgs)
function flagValue(argv: readonly string[], key: string): string | undefined {
  const idx = argv.indexOf(`--${key}`);
  if (idx === -1) return undefined;
  const next = argv[idx + 1];
  if (next === undefined || next.startsWith("--")) return undefined;
  return next;
}

function defaultConfigPath(home: string): string {
  // <OS-config-dir>/platform/config.toml — Linux: ~/.config/platform/config.toml
  return resolve(home, ".config", "platform", "config.toml");
}

interface RawConfigFile {
  gateway_url?: string;
  token?: string;
}

// minimal TOML-subset parser: `key = "value"` lines, `#` comments.
// unknown keys IGNORED (Q3 lock). no tables in v1 schema.
function parseConfigFile(text: string): RawConfigFile {
  const out: RawConfigFile = {};
  let inTable = false; // v1 schema has no tables — keys under [..] are ignored
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line === "" || line.startsWith("#")) continue;
    if (line.startsWith("[")) {
      inTable = true;
      continue;
    }
    if (inTable) continue;
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let val = line.slice(eq + 1).trim();
    if (val.startsWith('"') && val.endsWith('"')) val = val.slice(1, -1);
    if (key === "gateway_url") out.gateway_url = val;
    else if (key === "token") out.token = val;
    // unknown keys ignored
  }
  return out;
}

function checkPerms(path: string, warnings: string[]): void {
  try {
    const stat = statSync(path);
    // group/world read/write/exec bits set → warn (0600 = 0o600)
    if (stat.mode & 0o077) {
      warnings.push(`${path} is group/world-readable — consider chmod 600`);
    }
  } catch {
    // file missing → handled by caller
  }
}

function readTokenFromPath(path: string, warnings: string[]): string {
  const absolute = isAbsolute(path) ? path : resolve(path);
  let token: string;
  try {
    token = readFileSync(absolute, "utf8").trim();
  } catch {
    throw new ConfigError(`token file not found: ${absolute}`, 2);
  }
  if (token === "") throw new ConfigError(`token file is empty: ${absolute}`, 2);
  checkPerms(absolute, warnings);
  return token;
}

function resolveTokenValue(
  value: string | undefined,
  source: Source,
  warnings: string[],
): { token: string; source: Source } | null {
  if (value === undefined || value === "") return null;
  if (value.startsWith("path:")) {
    return { token: readTokenFromPath(value.slice(5), warnings), source };
  }
  return { token: value, source };
}

// no-echo token prompt (POSIX): readline with muted output. URL never
// prompted (Q3 lock — no default in v1).
async function promptToken(): Promise<string> {
  if (!isatty(0)) throw new ConfigError("token required (--token, PLATFORM_TOKEN, or config file)", 2);
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
  // mute echoed characters while reading (assign via Object.assign — no cast needed)
  Object.assign(rl, { _writeToOutput: () => {} });
  return await new Promise<string>((resolveToken, reject) => {
    rl.question("token: ", (ans) => {
      process.stdout.write("\n");
      rl.close();
      const trimmed = ans.trim();
      if (trimmed === "") reject(new ConfigError("token required (--token, PLATFORM_TOKEN, or config file)", 2));
      else resolveToken(trimmed);
    });
  });
}

export async function resolveConfig(opts: ResolveConfigOptions): Promise<ResolvedConfig> {  const argv = opts.argv;
  const env = opts.env;
  const isTTY = opts.isTTY ?? false;
  const cwd = opts.cwd ?? process.cwd();
  const home = opts.home ?? homedir();
  const warnings: string[] = [];

  const flagUrl = flagValue(argv, "url");
  const flagToken = flagValue(argv, "token");
  const configOverride = flagValue(argv, "config");

  const configPath = configOverride !== undefined ? resolve(cwd, configOverride) : defaultConfigPath(home);

  let fileUrl: string | undefined;
  let fileToken: string | undefined;
  let configFound = false;
  try {
    const text = readFileSync(configPath, "utf8");
    configFound = true;
    const raw = parseConfigFile(text);
    fileUrl = raw.gateway_url;
    fileToken = raw.token;
  } catch {
    // no config file → skip; not an error by itself
  }
  if (configFound && (fileUrl !== undefined || fileToken !== undefined)) {
    checkPerms(configPath, warnings);
  }

  const envUrl = env["PLATFORM_GATEWAY_URL"];
  const envToken = env["PLATFORM_TOKEN"];

  // token: flag > env > config > prompt (TTY only)
  const flagRes = resolveTokenValue(flagToken, Source.Flag, warnings);
  const envRes = resolveTokenValue(envToken, Source.Env, warnings);
  const fileRes = resolveTokenValue(fileToken, Source.ConfigFile, warnings);
  let token: string;
  let tokenSource: Source;
  if (flagRes !== null) {
    token = flagRes.token; tokenSource = flagRes.source;
  } else if (envRes !== null) {
    token = envRes.token; tokenSource = envRes.source;
  } else if (fileRes !== null) {
    token = fileRes.token; tokenSource = fileRes.source;
  } else if (isTTY) {
    token = await promptToken();
    tokenSource = Source.Prompt;
  } else {
    throw new ConfigError("token required (--token, PLATFORM_TOKEN, or config file)", 2);
  }

  // url: flag > env > config; never prompted (Q3 lock)
  let url: string;
  let urlSource: Source;
  if (flagUrl !== undefined && flagUrl !== "") {
    url = flagUrl; urlSource = Source.Flag;
  } else if (envUrl !== undefined && envUrl !== "") {
    url = envUrl; urlSource = Source.Env;
  } else if (fileUrl !== undefined && fileUrl !== "") {
    url = fileUrl; urlSource = Source.ConfigFile;
  } else {
    throw new ConfigError("gateway URL required (--url, PLATFORM_GATEWAY_URL, or config file)", 2);
  }

  return { url, token, tokenSource, urlSource, warnings };
}

// CID:config-003 - saveConfig
// Purpose: persist entries (currently: token) into the same config.toml that
//   resolveConfig reads — the D-112 ergonomics fix. Mint once, never retype.
//   Merge is line-based so unknown keys and other sections are preserved
//   verbatim; only the `token = "..."` line is replaced (or appended if the
//   file has none). Atomic write: tmp file in the same dir + rename, mode
//   0600 (same hygiene resolveConfig warns about when looser).
// Used by: cli.ts runToken (agentide token issue).
export interface SaveConfigOptions {
  home?: string;
  cwd?: string;
  configOverride?: string;
}

export interface SaveConfigResult {
  path: string;
  created: boolean; // true when the file did not exist before
}

function defaultConfigPathSync(home: string, cwd: string, configOverride?: string): string {
  if (configOverride !== undefined && configOverride !== "") {
    return resolve(cwd, configOverride);
  }
  return resolve(home, ".config", "platform", "config.toml");
}

export function saveConfig(
  entries: { token?: string },
  opts: SaveConfigOptions = {},
): SaveConfigResult {
  const home = opts.home ?? homedir();
  const cwd = opts.cwd ?? process.cwd();
  const path = defaultConfigPathSync(home, cwd, opts.configOverride);

  // Read the existing file verbatim (line-based merge preserves unknown keys
  // and any [table] sections the v1 parser ignores).
  let existed = false;
  let lines: string[] = [];
  let hasTokenLine = false;
  try {
    const text = readFileSync(path, "utf8");
    existed = true;
    lines = text.split(/\r?\n/);
  } catch {
    // no file yet → fresh content
  }

  const outLines: string[] = [];
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (entries.token !== undefined) {
      const eq = line.indexOf("=");
      if (eq !== -1 && line.slice(0, eq).trim() === "token") {
        outLines.push(`token = "${entries.token}"`);
        hasTokenLine = true;
        continue;
      }
    }
    outLines.push(rawLine);
  }
  if (entries.token !== undefined && !hasTokenLine) {
    outLines.push(`token = "${entries.token}"`);
  }
  // drop a single trailing empty line so the file ends cleanly
  while (outLines.length > 0 && outLines[outLines.length - 1] === "") {
    outLines.pop();
  }

  const body = outLines.join("\n") + "\n";
  const dir = dirname(path);
  mkdirSync(dir, { recursive: true });
  const tmp = `${path}.tmp-${process.pid}`;
  writeFileSync(tmp, body, { encoding: "utf8", mode: 0o600 });
  try {
    chmodSync(tmp, 0o600); // writeFileSync mode only applies on create
  } catch {
    // chmod unsupported (some fs fakes) — mode from writeFileSync stands
  }
  renameSync(tmp, path);

  return { path, created: !existed };
}

// CID:config-002 - hasUrlSource
// Purpose: remote-vs-in-process disambiguation for commands that exist in
//   both worlds (status, capability list). Remote config present (--url flag,
//   PLATFORM_GATEWAY_URL env, or config-file gateway_url) → remote dispatch.
//   Token is NOT required for the decision — a missing token surfaces later
//   as exit 2 from resolveConfig.
export async function hasUrlSource(
  argv: readonly string[],
  env: NodeJS.ProcessEnv,
  opts: { cwd?: string; home?: string } = {},
): Promise<boolean> {
  if (flagValue(argv, "url") !== undefined) return true;
  const envUrl = env["PLATFORM_GATEWAY_URL"];
  if (envUrl !== undefined && envUrl !== "") return true;
  const configOverride = flagValue(argv, "config");
  const configPath = configOverride !== undefined
    ? resolve(opts.cwd ?? process.cwd(), configOverride)
    : defaultConfigPath(opts.home ?? homedir());
  try {
    const raw = parseConfigFile(readFileSync(configPath, "utf8"));
    return raw.gateway_url !== undefined && raw.gateway_url !== "";
  } catch {
    return false;
  }
}
