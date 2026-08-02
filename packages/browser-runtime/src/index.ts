/*
 * Code Map: browser-runtime plugin entry.
 *
 * Plugin shape (BI[8a]): default export = handler map
 * `{ [capabilityName]: async (input, ctx) => result }` — the module
 * loaded via manifest `runtime.entry` (./dist/index.js).
 *
 * Named exports (host wiring):
 * - createBrowserRuntime: session registry + lifecycle wiring + the
 *   handler map, for tests and the gateway bootstrap.
 *
 * Session model: one Chromium process + one BrowserContext per session
 * (T1); sessions are lazy — created at first browser.launch; keyed by
 * ctx.sessionId (undefined -> "default").
 *
 * CID Index:
 * CID:index-001 -> createBrowserRuntime
 *
 * Quick lookup: rg -n "CID:index-" packages/browser-runtime/src/index.ts
 */

import { mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createSession, type Session } from "./session.js";
import { CapabilityHandler, createHandlers, type SessionRegistry } from "./handlers.js";

export type { CapabilityHandler, HandlerContext, SessionRegistry, JsonValue } from "./handlers.js";
export { createSession, resolveTabId } from "./session.js";
export { captureSnapshot } from "./snapshot.js";
export { attachLifecycle } from "./lifecycle.js";
export type { LifecycleBus } from "./lifecycle.js";
export { BrowserError, BROWSER_ERROR_CODES } from "./errors.js";
export * from "./types.js";

export interface BrowserRuntimeOptions {
  /** Base dir for per-session resource dirs (default: os tmpdir). */
  readonly resourceBase?: string;
  /** Called when the browser process dies unexpectedly (Q4). */
  readonly onDead?: (reason: string) => void;
}

export interface BrowserRuntime {
  readonly handlers: Record<string, CapabilityHandler>;
  readonly sessions: SessionRegistry;
}

// CID:index-001 - createBrowserRuntime
// Purpose: compose the plugin runtime — session registry keyed by
//   sessionId, handler map bound to it, optional lifecycle wiring.
// Uses: createSession, createHandlers, attachLifecycle
// Used by: gateway bootstrap / tests
export function createBrowserRuntime(opts: BrowserRuntimeOptions = {}): BrowserRuntime {
  const base = opts.resourceBase ?? tmpdir();
  const sessions = new Map<string, Session>();
  const onDead = opts.onDead ?? (() => { /* Q4: state.dead is the mechanism */ });

  const registry: SessionRegistry = {
    getOrCreate(sessionId: string | undefined): Session {
      const key = sessionId ?? "default";
      let session = sessions.get(key);
      if (session === undefined) {
        const resourceDir = join(base, `agentide-browser-${key}`);
        mkdirSync(resourceDir, { recursive: true });
        session = createSession(resourceDir, onDead);
        sessions.set(key, session);
      }
      return session;
    },
  };

  return {
    handlers: createHandlers(registry),
    sessions: registry,
  };
}

/** Default runtime — the plugin entry instance (module singleton). */
const runtime = createBrowserRuntime();
export const handlers = runtime.handlers;
export default handlers;
