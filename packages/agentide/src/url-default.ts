// CID:url-default-001 - applyPortDefault
// Purpose: Q2 from GRILL-cli-consumer-ux. The CLI consumer speaks the
//   adapter-websocket protocol on port 7300 at path /ws. When the operator
//   passes `--url` without an explicit port, insert `:7300`; when the path
//   is empty (or just "/"), append `/ws` so bare `ws://host:7300` URLs reach
//   the adapter's only door (adapter-websocket/server.ts binds path "/ws").
//   Custom paths are kept verbatim. The host is never defaulted (parent
//   GRILL Q3 — "no hardcoded default URL"; we narrow Q3 to "no default host"
//   only).
// Used by: consumer.ts (runConsumer, after resolveConfig).
import { ConfigError } from "./config.js";

const DEFAULT_PORT = "7300";
const DEFAULT_PATH = "/ws";

/**
 * If `rawUrl` has no port (per the WHATWG URL parser), insert `:7300`.
 * If the path is empty or "/", append `/ws`. Otherwise return it unchanged
 * (except port insertion). Throws `ConfigError` (exit 2) on parse failure.
 */
export function applyPortDefault(rawUrl: string): string {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new ConfigError(`invalid URL: ${rawUrl}`, 2);
  }
  if (parsed.port === "") parsed.port = DEFAULT_PORT;
  if (parsed.pathname === "" || parsed.pathname === "/") parsed.pathname = DEFAULT_PATH;
  return parsed.toString();
}
