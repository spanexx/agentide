/**
 * Phase 5 — lifecycle gates (GRILL T3).
 *
 *   - visibilitychange (Q1): hidden → pause the pending reconnect (timer
 *     cancelled, remembered); visible → fire the reconnect immediately —
 *     no extra backoff wait.
 *   - offline / online (Q2): offline → mark the socket dead + clear the
 *     timer; online → reset backoff + fire reconnect immediately.
 *   - pagehide (Q3): best-effort disconnect with `close(1000, "pagehide")`
 *     when leaving; skipped entirely when `event.persisted` (bfcache) so
 *     the round-trip survives back/forward navigation.
 *
 * Heartbeat is server-initiated only — there is zero SDK heartbeat code
 * (GRILL T3 Q4).
 */

import type { SdkClient } from "./client";

/** Attach browser lifecycle listeners; returns a cleanup function. */
export function attachLifecycle(client: SdkClient): () => void {
  const onVisibility = () => {
    if (document.hidden) {
      client.pauseReconnect();
    } else {
      client.reconnectNow();
    }
  };

  const onOffline = () => {
    client.markSocketDead();
  };

  const onOnline = () => {
    client.resetBackoff();
    client.reconnectNow();
  };

  const onPageHide = (ev: PageTransitionEvent) => {
    if (!ev.persisted) {
      client.disconnect("pagehide");
    }
    // persisted=true (bfcache): nothing is torn down.
  };

  document.addEventListener("visibilitychange", onVisibility);
  window.addEventListener("offline", onOffline);
  window.addEventListener("online", onOnline);
  window.addEventListener("pagehide", onPageHide);

  return () => {
    document.removeEventListener("visibilitychange", onVisibility);
    window.removeEventListener("offline", onOffline);
    window.removeEventListener("online", onOnline);
    window.removeEventListener("pagehide", onPageHide);
  };
}
