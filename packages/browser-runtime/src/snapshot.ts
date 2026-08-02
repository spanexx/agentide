/*
 * Code Map: per-tab capability snapshot with DOM-read settle (F11).
 *
 * Q5-revision: the runtime NEVER touches the shipped capability-registry.
 * It reads the DOM (`[data-sdk-cap]`, the shipped CAP_ATTR) once per
 * settle tick and stores the snapshot on the tab state at navigate.
 *
 * Settle (F11): read -> short wait -> re-read; when two consecutive
 * reads are identical the snapshot is stable -> capsSettled: true.
 * On settle-timeout, return what we have with capsSettled: false.
 *
 * CID Index:
 * CID:snapshot-001 -> captureSnapshot
 *
 * Quick lookup: rg -n "CID:snapshot-" packages/browser-runtime/src/snapshot.ts
 */

import type { BrowserDriver, CapabilitySnapshot, SessionState } from "./types.js";

const STABILITY_WAIT_MS = 150;
const SETTLE_TIMEOUT_MS = 2_000; // target <2s navigate latency (Risk Notes)

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function sameCaps(
  a: readonly CapabilitySnapshot[],
  b: readonly CapabilitySnapshot[],
): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    const x = a[i]!;
    const y = b[i]!;
    if (x.name !== y.name || x.count !== y.count) return false;
  }
  return true;
}

// CID:snapshot-001 - captureSnapshot
// Purpose: DOM-read settle loop. Mutates the tab's stored snapshot as
//   it converges (so capability.list answers stay current mid-settle).
// Uses: BrowserDriver.readCaps (driver-first — no Playwright here)
// Used by: navigate handler (browser-runtime)
export async function captureSnapshot(
  state: SessionState,
  driver: BrowserDriver,
  tabId: number,
): Promise<{ capabilities: readonly CapabilitySnapshot[]; capsSettled: boolean }> {
  const startedAt = Date.now();
  let prev: readonly CapabilitySnapshot[] = [];

  for (;;) {
    const { capabilities } = await driver.readCaps(tabId);
    state.tabs.set(tabId, { ...state.tabs.get(tabId)!, capabilities });

    if (capabilities.length === 0) {
      // Empty page settles immediately — nothing can appear "later"
      // in a way we can distinguish from a truly empty page; keep it
      // cheap. (F11: stability re-read only applies to non-empty sets.)
      return { capabilities, capsSettled: true };
    }

    if (sameCaps(prev, capabilities) && prev.length > 0) {
      return { capabilities, capsSettled: true };
    }

    if (Date.now() - startedAt >= SETTLE_TIMEOUT_MS) {
      return { capabilities, capsSettled: false };
    }

    prev = capabilities;
    await sleep(STABILITY_WAIT_MS);
  }
}
