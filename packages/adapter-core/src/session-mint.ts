/*
 * Code Map: adapter-core session auto-mint (A-pack seam, D-126 2026-08-09)
 * - withAutoMintSession: one canonical "mint a session, run, best-effort
 *   destroy" helper for door adapters. Mirrors the CLI's withAutoSession
 *   (packages/agentide/src/session-mint.ts, D-79) so the MCP door follows
 *   the SAME session lifecycle the CLI uses — per-request short sessions
 *   (Active → Destroyed), per the session-manager GRILL ("per-request
 *   sessions are short Active → Destroyed"; "the agent never calls
 *   suspend/resume directly — it's transparent").
 *
 * Why here: the A1 lock says doors import ONLY adapter-core for shared
 *   logic. The CLI keeps its own copy (agentide must not depend on
 *   adapter-core's gateway-typed seam for its one-shot path); adapters
 *   (MCP today, WS/REST later) use this one.
 *
 * CID Index:
 * CID:adapter-core-009 -> withAutoMintSession
 */

import type { Gateway, YamlValue } from "@spanexx/gateway-core";

export interface AutoMintOptions {
  /** ownerId for the minted session (defaults to the caller's callerId). */
  readonly ownerId?: string;
  /** adapterType for the minted session — "mcp" | "cli" | "rest" | "ws". */
  readonly adapterType?: "mcp" | "cli" | "rest" | "ws";
  /** Extra warnings collected during the call (destroy failures). */
  readonly warnings?: string[];
}

/**
 * Mint a session for the given token, run `fn(sessionId)`, then best-effort
 * destroy the session. Destroy failures are appended to `opts.warnings` and
 * ignored — the call result is the priority (same semantics as the CLI's
 * D-79 auto-mint).
 */
export async function withAutoMintSession<T>(
  gateway: Gateway,
  token: string,
  fn: (sessionId: string) => Promise<T>,
  opts: AutoMintOptions = {},
): Promise<T> {
  const claims = readCallerId(token);
  const ownerId = opts.ownerId ?? claims.callerId ?? "adapter";
  const adapterType = opts.adapterType ?? "mcp";
  const created = await gateway.handleInvocation({
    token,
    capability: { name: "session.create" },
    input: { ownerId, adapterType },
  });
  if ("error" in created) {
    throw new Error(`session auto-mint failed: ${created.error.message}`);
  }
  const sessionId = pickSessionId(created.output);
  if (sessionId === undefined) {
    throw new Error("session.create returned no session id");
  }
  try {
    return await fn(sessionId);
  } finally {
    try {
      await gateway.handleInvocation({
        token,
        capability: { name: "session.destroy" },
        input: { sessionId },
        sessionId,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const warnings = opts.warnings ?? [];
      warnings.push(`warning: session.destroy failed (${message})`);
    }
  }
}

function pickSessionId(value: YamlValue): string | undefined {
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    const id = (value as { id?: YamlValue }).id;
    if (typeof id === "string") return id;
  }
  return undefined;
}

/** Best-effort decode of the caller id from the (kernel-verified) JWT payload. */
function readCallerId(token: string): { callerId?: string } {
  try {
    const payload = JSON.parse(Buffer.from(token.split(".")[1] ?? "", "base64url").toString("utf8")) as {
      sub?: { callerId?: string };
    };
    return { callerId: payload.sub?.callerId };
  } catch {
    return {};
  }
}
