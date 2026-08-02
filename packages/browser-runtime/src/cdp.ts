/*
 * Code Map: CDP-driven ops seams for the Playwright driver.
 *
 * playwright-core 1.62 dropped `Browser.process()`, so the only
 * way to force-kill the browser process for crash simulation (Q4)
 * is through the Chrome DevTools Protocol. This file keeps the
 * CDP dance (newBrowserCDPSession, SystemInfo.getProcessInfo,
 * SIGKILL) out of driver.ts so the adapter stays under the
 * 350-line/file rule (see drift DR-BR-11).
 *
 * CID Index:
 * CID:cdp-001 -> cdpKillBrowser
 *
 * Quick lookup: rg -n "CID:cdp-" packages/browser-runtime/src/cdp.ts
 */

import type { Browser } from "playwright-core";

// CID:cdp-001 - cdpKillBrowser
// Purpose: Q4 crash-simulation seam. Walks CDP
//   SystemInfo.getProcessInfo, finds the browser-type entry, sends
//   SIGKILL. The resulting `disconnected` event on the Browser
//   fires the driver's `onDisconnected` -> `state.dead = true` ->
//   `onDead("browser disconnected")`.
//   No-op (returns false) when the browser ref is null or already
//   dead. Returns true when a SIGKILL was issued.
// Uses: playwright-core Browser (CDP session)
// Used by: driver.ts (kill)
export async function cdpKillBrowser(browser: Browser | null): Promise<boolean> {
  if (browser === null) return false;
  try {
    const session = await browser.newBrowserCDPSession();
    const info = (await session.send("SystemInfo.getProcessInfo")) as {
      processInfo: Array<{ type: string; id: number }>;
    };
    await session.detach().catch(() => {});
    const browserProc = info.processInfo.find((p) => p.type === "browser");
    if (browserProc === undefined) return false;
    process.kill(browserProc.id, "SIGKILL");
    return true;
  } catch {
    // already dead — nothing to kill
    return false;
  }
}
