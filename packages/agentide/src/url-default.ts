// CID:url-default-001 - applyPortDefault
// Purpose: Q2 from GRILL-cli-consumer-ux. The CLI consumer speaks the
//   adapter-websocket protocol on port 7300. When the operator passes
//   `--url` without an explicit port, insert `:7300`. The host is never
//   defaulted (parent GRILL Q3 — "no hardcoded default URL"; we narrow
//   Q3 to "no default host" only).
// Used by: consumer.ts (runConsumer, after resolveConfig).
import { ConfigError } from "./config.js";

const DEFAULT_PORT = "7300";

/**
 * If `rawUrl` has no port (per the WHATWG URL parser), insert `:7300`.
 * Otherwise return it unchanged. Throws `ConfigError` (exit 2) on parse failure.
 */
export function applyPortDefault(rawUrl: string): string {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new ConfigError(`invalid URL: ${rawUrl}`, 2);
  }
  if (parsed.port !== "") return rawUrl;
  parsed.port = DEFAULT_PORT;
  return parsed.toString();
}
