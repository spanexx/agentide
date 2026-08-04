// CID:consumer-001 - runConsumer
// Purpose: remote command surface for the agentide CLI (GRILL Q2–Q5, PRD S2–S8):
//   aliases (sessions/capabilities/plugins/status/health), invoke, watch.
//   Owns config resolution (flag > env > file > prompt), the WS client, and
//   TTY-aware output. In-process operator commands stay in cli.ts.
// Used by: cli.ts (remote dispatch), consumer.test.ts
import { createWsClient, WsInvokeError } from "@spanexx/adapter-websocket";
import type { YamlValue } from "@spanexx/gateway-core";
import { resolveConfig, ConfigError } from "./config";
import { ExitCode, exitCodeFor } from "./exit-codes";
import { renderTable, renderKeyValue, renderJson } from "./output";
import type { CliResult } from "./cli-types";

export interface ConsumerOptions {
  readonly argv?: readonly string[];
  readonly env: NodeJS.ProcessEnv;
  readonly isTTY?: boolean;
  readonly width?: number;
  readonly cwd?: string;
  readonly home?: string;
  /** Injectable signal wiring (watch Ctrl-C → exit 5). Default: SIGINT/SIGTERM. */
  readonly onSignal?: (handler: () => void) => () => void;
}

interface AliasDef {
  readonly capability: string;
  readonly kind: "table" | "kv";
  readonly columns?: readonly string[];
  readonly defaultTopic: string;
  readonly rows: (output: YamlValue) => readonly (readonly string[])[];
}

const cell = (v: YamlValue | undefined): string => (v === null || v === undefined ? "-" : String(v));

function rowForSessions(output: YamlValue): readonly (readonly string[])[] {
  if (!Array.isArray(output)) return [];
  return output.map((s) => {
    const o = s as { id?: YamlValue; status?: YamlValue; createdAt?: YamlValue };
    return [cell(o.id), cell(o.status), cell(o.createdAt)];
  });
}

function rowForCapabilities(output: YamlValue): readonly (readonly string[])[] {
  if (!Array.isArray(output)) return [];
  return output.map((c) => {
    const o = c as { name?: YamlValue; version?: YamlValue; tier?: YamlValue };
    return [cell(o.name), cell(o.version), cell(o.tier)];
  });
}

function rowForPlugins(output: YamlValue): readonly (readonly string[])[] {
  if (!Array.isArray(output)) return [];
  return output.map((p) => {
    const o = p as { id?: YamlValue; version?: YamlValue; enabled?: YamlValue };
    return [cell(o.id), cell(o.version), o.enabled === true ? "enabled" : "disabled"];
  });
}

// PRD S2/S7: alias → capability + table shape + watch default topic.
const ALIASES: Record<string, AliasDef> = {
  sessions: {
    capability: "session.list",
    kind: "table",
    columns: ["ID", "STATUS", "CREATED"],
    defaultTopic: "session.*",
    rows: rowForSessions,
  },
  capabilities: {
    capability: "capability.list",
    kind: "table",
    columns: ["NAME", "VERSION", "TIER"],
    defaultTopic: "capability.*",
    rows: rowForCapabilities,
  },
  plugins: {
    capability: "plugin.list",
    kind: "table",
    columns: ["ID", "VERSION", "STATUS"],
    defaultTopic: "plugin.*",
    rows: rowForPlugins,
  },
  status: {
    capability: "gateway.status",
    kind: "kv",
    defaultTopic: "gateway.*",
    rows: () => [],
  },
  health: {
    capability: "system.health",
    kind: "kv",
    defaultTopic: "gateway.*",
    rows: () => [],
  },
};

interface Parsed {
  readonly positional: readonly string[];
  readonly flags: Record<string, string | boolean | string[]>;
}

const BOOLEAN_FLAGS = new Set(["watch", "json"]);

function parseArgs(argv: readonly string[]): Parsed {
  const positional: string[] = [];
  const flags: Record<string, string | boolean | string[]> = {};
  let i = 0;
  while (i < argv.length) {
    const tok = argv[i];
    if (tok === undefined) break;
    if (tok.startsWith("--")) {
      const key = tok.slice(2);
      const next = argv[i + 1];
      if (BOOLEAN_FLAGS.has(key) || next === undefined || next.startsWith("--")) {
        flags[key] = true;
        i += 1;
      } else {
        flags[key] = next;
        i += 2;
      }
    } else {
      positional.push(tok);
      i += 1;
    }
  }
  return { positional, flags };
}

function flagValue(flags: Record<string, string | boolean | string[]>, key: string): string | undefined {
  const v = flags[key];
  return typeof v === "string" ? v : undefined;
}

function flagOn(flags: Record<string, string | boolean | string[]>, key: string): boolean {
  return flags[key] === true;
}

function isRecord(value: YamlValue): value is { readonly [k: string]: YamlValue } {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// CID:consumer-002 - runConsumer
export async function runConsumer(argv: readonly string[], opts: ConsumerOptions): Promise<CliResult> {
  const { positional, flags } = parseArgs(opts.argv ?? argv);
  const cmd = positional[0];
  if (cmd === undefined) {
    return resultStderr("usage: agentide {sessions|capabilities|plugins|status|health|invoke|watch} [flags]", ExitCode.Preflight);
  }

  const isTTY = opts.isTTY ?? (typeof process !== "undefined" && process.stdout.isTTY === true);
  const width = opts.width ?? (typeof process !== "undefined" ? process.stdout.columns : undefined);
  const render = { json: flagOn(flags, "json"), isTTY, width };

  // resolve config (flag > env > config file > prompt). ConfigError carries
  // exit 2; other resolution failures fall through to exitCodeFor.
  let url: string;
  let token: string;
  let warnings: string[];
  try {
    const resolved = await resolveConfig({
      argv,
      env: opts.env,
      isTTY,
      cwd: opts.cwd,
      home: opts.home,
    });
    url = resolved.url;
    token = resolved.token;
    warnings = resolved.warnings;
  } catch (err) {
    if (err instanceof ConfigError) {
      return resultStderr(`error: ${err.message}`, err.exitCode);
    }
    return resultStderr(`error: ${err instanceof Error ? err.message : String(err)}`, err instanceof Error ? exitCodeFor(err) : ExitCode.Preflight);
  }

  // connect + auth (S8: auth.error before auth.ok → exit 4)
  const client = createWsClient({ url, token });
  try {
    await client.open();
  } catch (err) {
    return resultStderr(`error: ${err instanceof Error ? err.message : String(err)}`, err instanceof Error ? exitCodeFor(err) : ExitCode.Preflight);
  }
  try {
    let res: CliResult;
    if (cmd === "invoke") {
      res = await runInvoke(client, positional.slice(1), flags, render, warnings);
    } else if (cmd === "watch" || flagOn(flags, "watch")) {
      const aliasName = cmd === "watch" ? positional[1] : cmd;
      res = await runWatch(client, aliasName, flags, render, opts);
    } else {
      // `capability list` (remote dispatch from cli.ts) → capabilities alias
      const aliasName = cmd === "capability" && positional[1] === "list" ? "capabilities" : cmd;
      const alias = ALIASES[aliasName];
      res = alias !== undefined
        ? await runAlias(client, alias, aliasName, render)
        : resultStderr(`error: unrecognized remote command: ${cmd}`, ExitCode.Preflight);
    }
    // S6: exactly ONE perms warning per run, on stderr, before any output
    if (warnings.length > 0) {
      res = { ...res, stderr: `${warnings.join("\n")}\n${res.stderr}` };
    }
    return res;
  } catch (err) {
    return resultStderr(`error: ${err instanceof Error ? err.message : String(err)}`, err instanceof Error ? exitCodeFor(err) : ExitCode.Preflight);
  } finally {
    await client.close();
  }
}

async function runAlias(
  client: ReturnType<typeof createWsClient>,
  alias: AliasDef,
  name: string,
  render: { json: boolean; isTTY: boolean; width?: number },
): Promise<CliResult> {
  const output = await client.invoke(alias.capability);
  if (alias.kind === "table" && !render.json && render.isTTY && alias.columns !== undefined) {
    return resultOut(renderTable(alias.columns, alias.rows(output), render));
  }
  if (alias.kind === "kv" && !render.json && render.isTTY && isRecord(output)) {
    return resultOut(renderKeyValue(output, render));
  }
  return resultOut(renderJson(output, render));
}

async function runInvoke(
  client: ReturnType<typeof createWsClient>,
  rest: readonly string[],
  flags: Record<string, string | boolean | string[]>,
  render: { json: boolean; isTTY: boolean; width?: number },
  warnings: string[],
): Promise<CliResult> {
  const name = rest[0];
  if (name === undefined) {
    return resultStderr("error: usage: agentide invoke <capability> [--args '<json>'] [--session <id>]", ExitCode.Preflight);
  }
  if (flagValue(flags, "mode") === "stream") {
    // PRD S4: the flag is a no-op in v1 — warning, then invoke proceeds as call.
    warnings.push("warning: --mode stream is reserved for v2; using call");
  }
  let input: YamlValue | undefined;
  const args = flagValue(flags, "args");
  if (args !== undefined) {
    try {
      input = JSON.parse(args) as YamlValue;
    } catch {
      return resultStderr(`error: invalid --args JSON: ${args}`, ExitCode.Preflight);
    }
  }
  const sessionId = flagValue(flags, "session");
  try {
    const output = await client.invoke(name, {
      ...(input === undefined ? {} : { input }),
      ...(sessionId === undefined ? {} : { sessionId }),
    });
    return resultOut(renderJson(output, render));
  } catch (err) {
    if (err instanceof WsInvokeError) {
      // S5: gateway code passed through verbatim — no third vocabulary
      return resultStderr(`error: ${err.code} — ${err.message}`, ExitCode.InvokeError);
    }
    return resultStderr(`error: ${err instanceof Error ? err.message : String(err)}`, err instanceof Error ? exitCodeFor(err) : ExitCode.Preflight);
  }
}

async function runWatch(
  client: ReturnType<typeof createWsClient>,
  aliasName: string | undefined,
  flags: Record<string, string | boolean | string[]>,
  render: { json: boolean; isTTY: boolean; width?: number },
  opts: ConsumerOptions,
): Promise<CliResult> {
  const alias = aliasName === undefined ? undefined : ALIASES[aliasName];
  if (alias === undefined) {
    return resultStderr(`error: unrecognized watch alias: ${String(aliasName)} (use sessions|capabilities|plugins|status|health)`, ExitCode.Preflight);
  }

  // snapshot once — normal TTY/--json shape (S7)
  let snapshot: string;
  try {
    const output = await client.invoke(alias.capability);
    if (alias.kind === "table" && !render.json && render.isTTY && alias.columns !== undefined) {
      snapshot = renderTable(alias.columns, alias.rows(output), render);
    } else if (alias.kind === "kv" && !render.json && render.isTTY && isRecord(output)) {
      snapshot = renderKeyValue(output, render);
    } else {
      snapshot = renderJson(output, render);
    }
  } catch (err) {
    if (err instanceof WsInvokeError) {
      return resultStderr(`error: ${err.code} — ${err.message}`, ExitCode.InvokeError);
    }
    return resultStderr(`error: ${err instanceof Error ? err.message : String(err)}`, err instanceof Error ? exitCodeFor(err) : ExitCode.Preflight);
  }

  // subscribe (--topic overrides default)
  const topic = flagValue(flags, "topic") ?? alias.defaultTopic;
  try {
    await client.subscribe([topic]);
  } catch (err) {
    return resultStderr(`error: ${err instanceof Error ? err.message : String(err)}`, err instanceof Error ? exitCodeFor(err) : ExitCode.Preflight);
  }

  // NDJSON event stream until signal → exit 5 (S7). Unexpected close ends
  // the watch (no reconnect in v1 — non-goal): pre-flight exit 2. A stats
  // frame with dropped > 0 → one stderr warning while streaming continues.
  const lines: string[] = [snapshot];
  let statsWarning: string | undefined;
  let settled = false;
  let finish: (r: CliResult) => void = () => {};
  const done = new Promise<CliResult>((resolve) => { finish = resolve; });
  const detach = (opts.onSignal ?? defaultSignal)(() => settle(resultOut(lines.join("\n"), statsWarning, ExitCode.Interrupted)));
  const settle = (r: CliResult): void => {
    if (settled) return;
    settled = true;
    detach();
    finish(statsWarning === undefined ? r : { ...r, stderr: `${statsWarning}\n${r.stderr}` });
  };
  client.onEvent((event) => {
    lines.push(JSON.stringify({
      type: "event", topic: event.topic, id: event.id, publishedAt: event.publishedAt, payload: event.payload,
    }));
  });
  client.onStats((dropped) => {
    if (statsWarning !== undefined || dropped === 0) return;
    statsWarning = `warning: gateway dropped ${dropped} events (backpressure)`;
  });
  client.onClose(() => settle(resultStderr("error: connection closed", ExitCode.Preflight)));
  return await done;
}

function defaultSignal(handler: () => void): () => void {
  const onSig = (): void => { handler(); };
  process.once("SIGINT", onSig);
  process.once("SIGTERM", onSig);
  return () => {
    process.removeListener("SIGINT", onSig);
    process.removeListener("SIGTERM", onSig);
  };
}

function resultOut(stdout: string, stderr = "", exitCode = ExitCode.Ok): CliResult {
  return { stdout, stderr, exitCode };
}

function resultStderr(message: string, exitCode: ExitCode): CliResult {
  return { stdout: "", stderr: `${message}\n`, exitCode };
}
