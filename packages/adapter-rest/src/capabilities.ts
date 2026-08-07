/*
 * Code Map: REST GET /capabilities handler (Phase 4)
 * - handleGetCapabilities: the door-side discovery handler. Extracts the
 *   bearer, calls the shared adapter-core capability lookup, and renders the
 *   response with the locked Q4 status map.
 * - Wraps the cards as `{capabilities: [...]}` per PRD-TRD Scenario 8.
 * - GET /capabilities/{name} is NOT handled here — deferred per D-100
 *   (`createCapabilityLookup.describe()` is broken against the kernel).
 *
 * CID Index:
 * CID:adapter-rest-capabilities-001 -> handleGetCapabilities
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import type { Gateway, YamlValue } from "@spanexx/gateway-core";
import {
  createCapabilityLookup,
  type DoorError,
  type ErrorConverter,
} from "@spanexx/adapter-core";
import { ERROR_CODES, type GatewayErrorPayload } from "@spanexx/errors";
import { extractBearer } from "./auth.js";
import { restErrorConverter } from "./errors.js";

const HEADER_AUTHORIZATION = "authorization";
const HEADER_CONTENT_TYPE = "content-type";
const CONTENT_TYPE_JSON = "application/json; charset=utf-8";

function headerValue(req: IncomingMessage, name: string): string | undefined {
  const raw = req.headers[name];
  if (raw === undefined) return undefined;
  if (typeof raw === "string") return raw;
  if (Array.isArray(raw) && raw.length > 0) return raw[0];
  return undefined;
}

function writeJson(res: ServerResponse, status: number, body: YamlValue): void {
  res.writeHead(status, { [HEADER_CONTENT_TYPE]: CONTENT_TYPE_JSON });
  res.end(JSON.stringify(body));
}

function writeDoorError(
  res: ServerResponse,
  errors: ErrorConverter,
  payload: GatewayErrorPayload,
): void {
  // restErrorConverter returns RestErrorPayload (DoorError + status + retryable);
  // the cast is at the boundary where we wired the door's converter.
  const converted = errors(payload) as ReturnType<typeof restErrorConverter>;
  writeJson(res, converted.status, {
    code: payload.code,
    message: payload.message,
    details: payload.details,
    retryable: payload.retryable,
  });
}

// CID:adapter-rest-capabilities-001 - handleGetCapabilities
// Purpose: GET /capabilities → 200 {capabilities: [...]} (PRD Scenario 8).
//   Bearer missing → 401 TOKEN_INVALID. Lookup errors → status from the
//   locked table; the body is the kernel's GatewayErrorPayload verbatim.
// Used by: server.ts (Phase 5 router).
export async function handleGetCapabilities(
  req: IncomingMessage,
  res: ServerResponse,
  gateway: Gateway,
  errors: ErrorConverter = restErrorConverter,
): Promise<void> {
  const token = extractBearer(headerValue(req, HEADER_AUTHORIZATION));
  if (token === null) {
    writeDoorError(res, errors, {
      code: ERROR_CODES.TOKEN_INVALID,
      message: "missing bearer token",
      details: {},
      retryable: false,
    });
    return;
  }

  const lookup = createCapabilityLookup({ gateway, errors });
  const outcome = await lookup.list(token);
  if (outcome.ok) {
    // JSON.stringify accepts any serializable value; explicit header +
    // stringification keep the wire shape identical to writeJson.
    res.writeHead(200, { [HEADER_CONTENT_TYPE]: CONTENT_TYPE_JSON });
    res.end(JSON.stringify({ capabilities: outcome.value }));
    return;
  }

  // The shared LookupOutcome type exposes only {code, message}; at runtime
  // restErrorConverter produced a RestErrorPayload with status + retryable
  // + details. Cast at the door boundary — we wired the door's converter.
  const converted = outcome.error as DoorError & {
    readonly status: number;
    readonly retryable: boolean;
  };
  writeJson(res, converted.status, {
    code: converted.code,
    message: converted.message,
    details: converted.details ?? {},
    retryable: converted.retryable,
  });
}