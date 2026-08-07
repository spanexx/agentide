/*
 * Code Map: REST POST /invoke handler (Phase 3)
 * - handleInvoke: the door-side invocation handler. Parses the request,
 *   drives the shared adapter-core pipeline, and renders the response with
 *   the locked Q4 status map.
 * - createRestSink: per-invocation ResponseChannelSink that captures one
 *   emitResult (success) or emitError (failure) — same shape as
 *   packages/adapter-mcp/src/translate.ts:180 (`mcpCallToolSink`), adapted
 *   to the REST door's verbatim-body + status-table render model.
 * - readJsonBody: minimal IncomingMessage body reader (modeled on
 *   packages/adapter-mcp/src/server.ts:206 — `readBody`).
 * - parseInvokeBody: strict shape check for the {capability, input?, sessionId?}
 *   request envelope; failures become 400 INVALID_REQUEST payloads.
 *
 * Body shape contract (PRD-TRD §"API Contracts"):
 *   request  → {capability: string, input?: object, sessionId?: string}
 *   success  → 200 {output: <CanonicalResponse.output>}
 *   error    → <table-status> {code, message, details, retryable} (verbatim)
 *
 * CID Index:
 * CID:adapter-rest-invoke-001 -> RestSinkResult + RestSinkError
 * CID:adapter-rest-invoke-002 -> createRestSink
 * CID:adapter-rest-invoke-003 -> handleInvoke
 * CID:adapter-rest-invoke-004 -> readJsonBody + parseInvokeBody
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import type { Gateway, YamlValue } from "@spanexx/gateway-core";
import { ERROR_CODES, type GatewayErrorPayload } from "@spanexx/errors";
import {
  createAdapterPipeline,
  type DoorError,
  type ErrorConverter,
  type ResponseChannelSink,
} from "@spanexx/adapter-core";
import type { RestInvokeRequest } from "./types.js";
import { extractBearer } from "./auth.js";
import { restErrorConverter } from "./errors.js";

const HEADER_AUTHORIZATION = "authorization";
const HEADER_CONTENT_TYPE = "content-type";
const CONTENT_TYPE_JSON = "application/json; charset=utf-8";

// CID:adapter-rest-invoke-001 - RestSinkResult / RestSinkError
// Purpose: captured terminal state from the pipeline — exactly one of these
//   per invocation. `status` is the locked Q4 HTTP status (errors only).
export interface RestSinkResult {
  readonly ok: true;
  readonly output: YamlValue;
}
export interface RestSinkError {
  readonly ok: false;
  readonly status: number;
  readonly body: GatewayErrorPayload;
}

// CID:adapter-rest-invoke-002 - createRestSink
// Purpose: per-invocation sink. Buffers the single emitResult / emitError so
//   the handler can render the HTTP response after pipeline.invoke returns.
//   emitChunk / emitEvent drop — REST v1 is unary (no streaming, no events).
function createRestSink(): ResponseChannelSink & { readonly result: RestSinkResult | RestSinkError | undefined } {
  let captured: RestSinkResult | RestSinkError | undefined;
  const sink: ResponseChannelSink & { result: RestSinkResult | RestSinkError | undefined } = {
    result: undefined,
    emitChunk(_chunk: YamlValue) {
      /* unary — drop */
    },
    emitEvent(_topic: string, _payload: YamlValue) {
      /* REST v1 forwards no events — drop */
    },
    emitResult(output: YamlValue) {
      captured = { ok: true, output };
    },
    emitError(error: DoorError) {
      // restErrorConverter produces RestErrorPayload (DoorError + status +
      // retryable); the shared seam only sees DoorError. Cast is honest at
      // this boundary — we wired the door's converter.
      const e = error as DoorError & { readonly status: number; readonly retryable: boolean };
      const body: GatewayErrorPayload = {
        code: e.code as string,
        message: e.message,
        details: e.details ?? {},
        retryable: e.retryable,
      };
      captured = { ok: false, status: e.status, body };
    },
  };
  // Late-bind captured into the result getter so callers see the latest.
  Object.defineProperty(sink, "result", {
    get: () => captured,
  });
  return sink;
}

// CID:adapter-rest-invoke-004 - readJsonBody + parseInvokeBody
// Purpose: turn an IncomingMessage into a {capability, input?, sessionId?}
//   envelope — strict shape, no extra fields accepted.
function readJsonBody(req: IncomingMessage): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf-8")));
    req.on("error", reject);
  });
}

function parseInvokeBody(raw: string): RestInvokeRequest {
  let parsed: YamlValue;
  try {
    parsed = JSON.parse(raw) as YamlValue;
  } catch {
    throw new InvalidRequestError("invalid JSON body");
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new InvalidRequestError("request body must be a JSON object");
  }
  const rec = parsed as Readonly<Record<string, YamlValue>>;
  const capability = rec["capability"];
  if (typeof capability !== "string" || capability.length === 0) {
    throw new InvalidRequestError('missing or invalid "capability" field');
  }
  const input = rec["input"];
  const sessionId = rec["sessionId"];
  return {
    capability,
    ...(input !== undefined ? { input: input as Readonly<Record<string, YamlValue>> } : {}),
    ...(typeof sessionId === "string" ? { sessionId } : {}),
  };
}

class InvalidRequestError extends Error {
  override readonly name = "InvalidRequestError";
}

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

// CID:adapter-rest-invoke-003 - handleInvoke
// Purpose: drive one POST /invoke end-to-end. Door-fabricated errors
//   (missing bearer, bad body) go through restErrorConverter too — the
//   status map is the single source of truth for every status decision.
export async function handleInvoke(
  req: IncomingMessage,
  res: ServerResponse,
  gateway: Gateway,
  errors: ErrorConverter = restErrorConverter,
): Promise<void> {
  // 1. Bearer token (PRD Scenario 3).
  const token = extractBearer(headerValue(req, HEADER_AUTHORIZATION));
  if (token === null) {
    const fabricated: GatewayErrorPayload = {
      code: ERROR_CODES.TOKEN_INVALID,
      message: "missing bearer token",
      details: {},
      retryable: false,
    };
    const converted = errors(fabricated) as ReturnType<typeof restErrorConverter>;
    writeJson(res, converted.status, {
      code: fabricated.code,
      message: fabricated.message,
      details: fabricated.details,
      retryable: fabricated.retryable,
    });
    return;
  }

  // 2. Body (PRD Scenario 8 implicitly — invalid body).
  let body: RestInvokeRequest;
  try {
    const raw = await readJsonBody(req);
    body = parseInvokeBody(raw);
  } catch (err) {
    const message = err instanceof InvalidRequestError ? err.message : "failed to read request body";
    const fabricated: GatewayErrorPayload = {
      code: ERROR_CODES.INVALID_REQUEST,
      message,
      details: {},
      retryable: false,
    };
    const converted = errors(fabricated) as ReturnType<typeof restErrorConverter>;
    writeJson(res, converted.status, {
      code: fabricated.code,
      message: fabricated.message,
      details: fabricated.details,
      retryable: fabricated.retryable,
    });
    return;
  }

  // 3. Pipeline (success → emitResult, error → emitError).
  const sink = createRestSink();
  const pipeline = createAdapterPipeline({
    gateway,
    errors,
    response: (_correlationId: string) => sink,
  });
  const correlationId = `inv-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  try {
// Door-side input is loosely typed (Record<string, YamlValue>); the kernel
    //   requires YamlValue. Cast is the boundary — the kernel's input/output
    //   schema validation enforces actual shape downstream.
    const input = (body.input ?? {}) as YamlValue;
    await pipeline.invoke({
      correlationId,
      token,
      name: body.capability,
      input,
      ...(body.sessionId !== undefined ? { sessionId: body.sessionId } : {}),
    });
  } catch (err) {
    // Unexpected pipeline throw — render the runtime family's 500 with a
    // verbatim payload. Matches MCP's defensive path for unreachable sinks.
    const message = err instanceof Error ? err.message : "unknown pipeline error";
    const fabricated: GatewayErrorPayload = {
      code: ERROR_CODES.HANDLER_ERROR,
      message,
      details: {},
      retryable: true,
    };
    writeJson(res, 500, {
      code: fabricated.code,
      message: fabricated.message,
      details: fabricated.details,
      retryable: fabricated.retryable,
    });
    return;
  }

  // 4. Render the captured terminal state.
  const result = sink.result;
  if (result === undefined) {
    // Pipeline returned without ending — defensive 500.
    writeJson(res, 500, {
      code: ERROR_CODES.INTERNAL_ERROR,
      message: "pipeline did not produce a terminal state",
      details: {},
      retryable: false,
    });
    return;
  }
  if (result.ok) {
    writeJson(res, 200, { output: result.output });
    return;
  }
  // JSON.stringify accepts any serializable value; the GatewayErrorPayload
  //   has named properties (no index signature) so it isn't structurally
  //   assignable to YamlValue — inline the stringify at this boundary.
  res.writeHead(result.status, { [HEADER_CONTENT_TYPE]: CONTENT_TYPE_JSON });
  res.end(JSON.stringify(result.body));
}