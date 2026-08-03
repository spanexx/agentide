/*
 * Code Map: adapter-websocket client frame parser
 * - parseClientFrame: validate raw JSON against the four client→server families
 *
 * CID Index:
 * CID:protocol-001 -> parseClientFrame
 * CID:protocol-002 -> AuthCandidate
 * CID:protocol-003 -> InvalidFrame
 *
 * Quick lookup: rg -n "CID:protocol-" packages/adapter-websocket/src/protocol.ts
 */

import type { YamlValue } from "@platform/gateway-core";
import { parseInvokeFrame } from "./invoke.js";
import type { ClientFrame, InvokeFrame, SubscribeFrame, UnsubscribeFrame } from "./types.js";

// CID:protocol-002 - AuthCandidate
// Purpose: a deliberately lenient auth-frame shape — `token` may be undefined
//   or empty so the auth pipeline (server.ts → authenticateToken) can map the
//   locked "token missing" phrase code 1:1 to the wire. The locked `AuthFrame`
//   (in types.ts) requires `token: string` and is what callers construct after
//   the parser approves the input.
export interface AuthCandidate {
  readonly type: "auth";
  readonly token: string | undefined;
}

// CID:protocol-003 - InvalidFrame
// Purpose: anything that doesn't pass the parser becomes a structured invalid
//   frame so the server can emit WS_INVALID_FRAME without re-parsing raw JSON.
export interface InvalidFrame {
  readonly type: "invalid";
  readonly message: string;
}

export type ParsedClientFrame = ClientFrame | AuthCandidate | InvalidFrame;

type ValueRecord = { readonly [key: string]: YamlValue };

// CID:protocol-001 - parseClientFrame
// Purpose: single entry point for inbound wire frames. Returns the typed
//   ParsedClientFrame union so the server can dispatch on `frame.type` without
//   ever re-touching the raw JSON. Each branch enforces the required keys for
//   its family (W4 sub-Q 2).
export function parseClientFrame(value: YamlValue): ParsedClientFrame {
  if (!isRecord(value)) return { type: "invalid", message: "frame must be an object" };
  if (value.type === "auth") {
    return { type: "auth", token: typeof value.token === "string" ? value.token : undefined };
  }
  if (value.type === "subscribe" || value.type === "unsubscribe") {
    if (!Array.isArray(value.topics) || value.topics.length === 0 || value.topics.some((topic) => typeof topic !== "string")) {
      return { type: "invalid", message: "topics must be a non-empty array of strings" };
    }
    const topics = value.topics as readonly string[];
    return value.type === "subscribe"
      ? ({ type: "subscribe", topics } satisfies SubscribeFrame)
      : ({ type: "unsubscribe", topics } satisfies UnsubscribeFrame);
  }
  if (value.type === "invoke") {
    const frame = parseInvokeFrame(value);
    return frame ?? { type: "invalid", message: "invalid invoke frame" };
  }
  return { type: "invalid", message: "unknown frame type" };
}

function isRecord(value: YamlValue): value is ValueRecord {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function isInvokeFrame(frame: ParsedClientFrame): frame is InvokeFrame {
  return frame.type === "invoke";
}
