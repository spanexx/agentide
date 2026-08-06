// CID:session-mint-001 - withAutoSession
// Purpose: Q1 from GRILL-cli-consumer-ux. When `agentide invoke` is called
//   without `--session`, the CLI mints a session via session.create, runs
//   the wrapped `fn(sessionId)`, then best-effort destroys the session.
//   Matches the SDK/dashboard lifecycle for one-shot CLI invocations.
//   Destroy errors are logged via the `warnings` array (Q1 lock: best-effort).
// Used by: consumer.ts (runInvoke, runWatch).
import type { YamlValue } from "@spanexx/gateway-core";

/** Minimal client interface — must implement `invoke(name, {input, sessionId})`. */
export interface AutoSessionClient {
  invoke(name: string, options?: { readonly input?: YamlValue; readonly sessionId?: string }): Promise<YamlValue>;
}

export interface WithAutoSessionOptions {
  /** Extra warnings collected during the call (e.g. destroy errors). */
  readonly warnings?: string[];
}

/**
 * Mint a session, run `fn(sessionId)`, then destroy the session.
 * Returns whatever `fn` returns. Destroy errors are appended to `opts.warnings`
 * (if provided) and ignored — the user's invoke result is the priority.
 */
export async function withAutoSession<T>(
  client: AutoSessionClient,
  fn: (sessionId: string) => Promise<T>,
  opts: WithAutoSessionOptions = {},
): Promise<T> {
  const created = await client.invoke("session.create", { input: {} });
  // session.create returns { id: string }. Defensive: support either shape.
  const sessionId = pickSessionId(created);
  if (sessionId === undefined) {
    throw new Error("session.create returned no session id");
  }
  try {
    return await fn(sessionId);
  } finally {
    try {
      await client.invoke("session.destroy", { sessionId });
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
