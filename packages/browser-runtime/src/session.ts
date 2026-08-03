/*
 * Code Map: session state machine for the browser runtime.
 *
 * Plain-data SessionState (types.ts) + a factory that binds it to a
 * BrowserDriver (driver.ts). Per-session: one Chromium context (T1),
 * tab ids increment per context and are never reused (F1), fresh
 * context after crash-relaunch resets the counter (Q4).
 *
 * CID Index:
 * CID:session-001 -> createSession
 * CID:session-002 -> resolveTabId
 *
 * Quick lookup: rg -n "CID:session-" packages/browser-runtime/src/session.ts
 */

import type { BrowserDriver, SessionState } from "./types.js";
import { BROWSER_ERROR_CODES, BrowserError } from "./types.js";
import { createDriver } from "./driver.js";

export interface Session {
  readonly state: SessionState;
  readonly driver: BrowserDriver;
}

// CID:session-001 - createSession
// Purpose: seed a fresh session (no browser process yet) and bind the
//   driver. resourceDir is the session's resource directory (screenshots
//   written there; purged on session.cleanup_resources).
// Uses: createDriver, SessionState
// Used by: index.ts (session factory)
export function createSession(resourceDir: string, onDead: (reason: string) => void): Session {
  const state: SessionState = {
    launched: false,
    mode: "headless",
    dead: false,
    tabs: new Map(),
    activeTabId: -1,
    nextTabId: 0,
    resourceDir,
  };
  const driver = createDriver(state, onDead);
  return { state, driver };
}

// CID:session-002 - resolveTabId
// Purpose: resolve a capability's optional tabId to the active tab
//   (default most-recently-active, F2). Throws TAB_NOT_FOUND when the
//   session has no tabs at all.
// Uses: SessionState
// Used by: handlers (navigate/click/type/query/scroll/screenshot/close)
export function resolveTabId(state: SessionState, tabId: number | undefined): number {
  if (tabId !== undefined) return tabId;
  if (state.activeTabId >= 0) return state.activeTabId;
  throw new BrowserError(
    BROWSER_ERROR_CODES.TAB_NOT_FOUND,
    "no tabs in this session; open one with browser.tab.open",
  );
}
