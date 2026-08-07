/*
 * Code Map: adapter-core error converter (A5)
 * - createErrorConverter: shared kernel-error → door-payload translator.
 *   The GatewayErrorPayload (re-exported from @spanexx/errors) IS the shared
 *   envelope; doors keep their own code tables and hand them in as
 *   `errors: table` (A5, Option A).
 * - Unmapped codes → shared default fallback: {code: -32006,
 *   message: `${code}: ${message}`} (matches adapter-mcp's fallback exactly).
 *   Doors may override the default via `defaultError`.
 * - Door payload shape: `code` is string | number so both WS (string codes,
 *   verbatim passthrough) and MCP (numeric JSON-RPC codes) can use it.
 *
 * CID Index:
 * CID:adapter-core-003 -> createErrorConverter + DoorError + ErrorTable
 */

import type { GatewayErrorDetailValue, GatewayErrorPayload } from "@spanexx/errors";

// CID:adapter-core-003 - DoorError
// Purpose: wire-facing error produced by the converter. `code` is string for
//   doors that pass codes verbatim (WS) or number for doors that translate
//   to protocol codes (MCP JSON-RPC -32001..-32006).
export interface DoorError {
  readonly code: string | number;
  readonly message: string;
  readonly details?: Readonly<Record<string, GatewayErrorDetailValue>>;
}

export type ErrorTableEntry = DoorError | ((payload: GatewayErrorPayload) => DoorError);

export type ErrorTable = Readonly<Record<string, ErrorTableEntry>>;

export interface ErrorConverterOptions {
  /** Door-local code table: gateway code → door payload. */
  readonly table?: ErrorTable;
  /** Door-configurable fallback for unmapped codes (A5 Option A). */
  readonly defaultError?: DoorError | ((payload: GatewayErrorPayload) => DoorError);
}

export type ErrorConverter = (payload: GatewayErrorPayload) => DoorError;

// Shared default fallback (A5): mirrors adapter-mcp's unmapped path so every
// door renders the same `-32006` + `${code}: ${message}` when its table
// doesn't know a code.
const SHARED_DEFAULT = (payload: GatewayErrorPayload): DoorError => ({
  code: -32006,
  message: `${payload.code}: ${payload.message}`,
});

export function createErrorConverter(options: ErrorConverterOptions = {}): ErrorConverter {
  const { table = {}, defaultError = SHARED_DEFAULT } = options;
  return (payload: GatewayErrorPayload): DoorError => {
    const entry = table[payload.code];
    if (entry !== undefined) {
      return typeof entry === "function" ? entry(payload) : entry;
    }
    return typeof defaultError === "function" ? defaultError(payload) : defaultError;
  };
}
