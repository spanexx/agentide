/*
 * Code Map: Playwright adapter — the BrowserDriver engine.
 *
 * Implements the plain-data BrowserDriver interface (types.ts) over
 * playwright-core. All Playwright types are confined to this file
 * (driver-first rule, T1): handlers and session only ever see plain
 * JSON shapes and numeric tab ids.
 *
 * Cross-module helpers (split out per drift DR-BR-11, 350-line rule):
 *   - address.ts — F8 `resolveLocator` + in-page `computeAddressesForSelector`
 *   - tier.ts    — `tierFromName` for the DOM-read caps inference
 *   - cdp.ts     — `cdpKillBrowser` for the Q4 crash-simulation seam
 *
 * Key patterns (opensrc-verified against playwright-core@1.62.1):
 * chromium.launch (headless default true), browser.on('disconnected')
 * (Q4 crash signal), browser.newContext (one context per session, T1),
 * page.evaluate (DOM-read settle F11), page.locator(sel).nth(i) (F8).
 *
 * CID Index: CID:driver-001 -> createDriver; CID:driver-002 -> ensureAlive
 * Quick lookup: rg -n "CID:driver-" packages/browser-runtime/src/driver.ts
 */

import { chromium } from "playwright-core";
import type { Browser, BrowserContext, Page } from "playwright-core";
import { writeFile } from "node:fs/promises";
import type { BrowserDriver, CapabilitySnapshot, SessionState, TabState } from "./types.js";
import { BROWSER_ERROR_CODES, BrowserError } from "./types.js";
import { computeAddressesForSelector, resolveLocator } from "./address.js";
import { cdpKillBrowser } from "./cdp.js";
import { tierFromName } from "./tier.js";

/** Non-serializable refs the driver owns privately (kept OUT of SessionState so that stays plain data, driver-first). */
interface DriverRefs {
  browser: Browser;
  context: BrowserContext;
  pages: Map<number, Page>;
}

const INLINE_BYTE_CAP = 256 * 1024; // T3: 256 KiB inline limit

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// CID:driver-001 - createDriver
// Purpose: build the driver bound to a session state + resource dir.
//   One BrowserContext per session (T1). Tab 0 is created at launch (F1).
//   browser.on('disconnected') marks the session dead (Q4). The returned
//   object also carries kill() — a plain-data test/ops seam that
//   force-kills the browser process (crash simulation; no Playwright
//   types leak into the public surface).
// Uses: playwright-core chromium; mutates SessionState (tabs, dead)
// Used by: session.ts (launch), handlers.ts (all caps)
export function createDriver(
  state: SessionState,
  onDead: (reason: string) => void,
): BrowserDriver & { kill(): Promise<void> } {
  let refs: DriverRefs | null = null;

  // Q4: crash detection — detached on graceful close so close() never
  // spuriously marks the session dead.
  function onDisconnected(): void {
    state.dead = true;
    onDead("browser disconnected");
  }

  function ensureRefs(): DriverRefs {
    if (refs === null) {
      throw new BrowserError(
        BROWSER_ERROR_CODES.NO_CONTEXT,
        "browser is not launched; call browser.launch first",
      );
    }
    return refs;
  }

  function ensureAlive(): void {
    if (state.dead) {
      throw new BrowserError(
        BROWSER_ERROR_CODES.CRASHED,
        "browser process is dead; relaunch with browser.launch",
        {},
        true, // Q4: retryable
      );
    }
  }

  function tabPage(tabId: number): Page {
    ensureAlive();
    const refs_ = ensureRefs();
    const page = refs_.pages.get(tabId);
    if (page === undefined || page.isClosed()) {
      throw new BrowserError(
        BROWSER_ERROR_CODES.TAB_NOT_FOUND,
        `tab ${tabId} does not exist`,
      );
    }
    return page;
  }

  function syncTab(tabId: number, page: Page, url: string, caps: readonly CapabilitySnapshot[]): void {
    state.tabs.set(tabId, {
      id: tabId,
      url,
      capabilities: caps,
      capsSettled: false,
    } satisfies TabState);
    state.activeTabId = tabId;
  }

  return {
    // ------------------------------------------------------------------ launch
    // Q4/F1: if dead (crash) this RELAUNCHES a fresh context (counter
    // resets); only a live launched browser errors with ALREADY_LAUNCHED.
    async launch(mode) {
      if (state.launched && !state.dead) {
        throw new BrowserError(
          BROWSER_ERROR_CODES.ALREADY_LAUNCHED,
          "browser is already launched",
        );
      }
      try {
        const browser = await chromium.launch({
          headless: mode !== "headed",
          args: ["--no-sandbox"],
        });
        const context = await browser.newContext();
        const page = await context.newPage(); // F1: tab 0 exists at launch
        refs = { browser, context, pages: new Map([[0, page]]) };
        state.launched = true;
        state.mode = mode;
        state.dead = false;
        state.tabs.clear();
        state.nextTabId = 1;
        syncTab(0, page, "about:blank", []);
        browser.on("disconnected", onDisconnected);
      } catch (err) {
        throw new BrowserError(
          BROWSER_ERROR_CODES.LAUNCH_FAILED,
          `chromium launch failed: ${err instanceof Error ? err.message : String(err)}`,
          {},
          true, // LAUNCH_FAILED retryable:true (capability-contracts.md)
        );
      }
    },

    // ------------------------------------------------------------------- close
    // Idempotent: closing an already-closed/dead browser is a no-op
    // (never throws CLOSED — callers may close defensively).
    // Closes the BROWSER too (not just the context) so the chromium
    // process exits — no per-session leak (drift BR-1).
    async close() {
      if (!state.launched || state.dead || refs === null) return;
      const refs_ = refs;
      const pages = [...refs_.pages.values()];
      for (const page of pages) {
        try {
          await page.close();
        } catch {
          // already closed — fine during teardown
        }
      }
      refs_.browser.off("disconnected", onDisconnected);
      try {
        await refs_.context.close();
      } catch {
        // context may already be gone after a crash — fine
      }
      try {
        await refs_.browser.close();
      } catch {
        // browser may already be gone after a crash — fine
      }
      refs = null;
      state.tabs.clear();
      state.launched = false;
    },

    // ----------------------------------------------------------------- tabs
    async openTab() {
      ensureAlive();
      const refs_ = ensureRefs();
      const page = await refs_.context.newPage();
      const id = state.nextTabId;
      state.nextTabId += 1;
      refs_.pages.set(id, page);
      syncTab(id, page, "about:blank", []);
      return id;
    },

    async closeTab(tabId) {
      const page = tabPage(tabId);
      await page.close();
      refs!.pages.delete(tabId);
      state.tabs.delete(tabId);
      if (state.activeTabId === tabId) {
        state.activeTabId = state.tabs.size > 0 ? Math.min(...state.tabs.keys()) : -1;
      }
    },

    async switchTab(tabId) {
      tabPage(tabId); // throws TAB_NOT_FOUND if missing
      state.activeTabId = tabId;
    },

    // -------------------------------------------------------------- navigate
    async navigate(tabId, url, opts) {
      const page = tabPage(tabId);
      try {
        await page.goto(url, {
          waitUntil: opts.waitUntil ?? "load",
          timeout: opts.timeoutMs ?? 30_000,
        });
      } catch (err) {
        const isTimeout =
          err instanceof Error &&
          (err.message.includes("Timeout") || err.name === "TimeoutError");
        throw new BrowserError(
          isTimeout ? BROWSER_ERROR_CODES.NAVIGATION_TIMEOUT : BROWSER_ERROR_CODES.NAVIGATION_FAILED,
          `navigate to ${url} failed: ${err instanceof Error ? err.message : String(err)}`,
          { url },
          isTimeout, // T2: timeout retryable, hard failures not
        );
      }
      const finalUrl = page.url();
      syncTab(tabId, page, finalUrl, []);
      return { url: finalUrl };
    },

    // ------------------------------------------------------------ DOM read
    async readCaps(tabId) {
      const page = tabPage(tabId);
      const raw = await page.evaluate(() => {
        const counts = new Map<string, number>();
        for (const el of document.querySelectorAll('[data-sdk-cap]')) {
          const name = el.getAttribute("data-sdk-cap");
          if (name === null || name === "") continue;
          counts.set(name, (counts.get(name) ?? 0) + 1);
        }
        return [...counts.entries()].map(([name, count]) => ({ name, count }));
      });
      const capabilities = raw.map(({ name, count }) => {
        const tier = tierFromName(name);
        return {
          name,
          tier,
          version: "1.0.0", // sdk-browser defaultVersion
          count,
          registered: count > 0,
        } satisfies CapabilitySnapshot;
      });
      state.tabs.set(tabId, { ...state.tabs.get(tabId)!, capabilities });
      return { capabilities, capsSettled: false };
    },

    // ------------------------------------------------------------- query
    async query(tabId, selector) {
      const page = tabPage(tabId);
      const matches = await page.locator(selector).count();
      if (matches === 0) return { matches: 0, addresses: [] };
      const addresses = await page.evaluate(computeAddressesForSelector, selector);
      return { matches, addresses };
    },

    // ------------------------------------------------------------ clicks
    async click(tabId, selector, opts) {
      const loc = await resolveLocator(tabPage(tabId), selector, opts.instance);
      await loc.click({ button: opts.button ?? "left" });
    },

    async type(tabId, selector, text, opts) {
      const loc = await resolveLocator(tabPage(tabId), selector, opts.instance);
      await loc.fill("");
      await loc.pressSequentially(text, opts.delayMs ? { delay: opts.delayMs } : undefined);
    },

    async scroll(tabId, opts) {
      const page = tabPage(tabId);
      if (opts.selector !== undefined) {
        const loc = await resolveLocator(page, opts.selector, undefined);
        await loc.scrollIntoViewIfNeeded();
        return;
      }
      const px = opts.px ?? page.viewportSize()?.height ?? 800;
      const dx = opts.direction === "left" ? -px : opts.direction === "right" ? px : 0;
      const dy = opts.direction === "up" ? -px : opts.direction === "down" ? px : 0;
      await page.mouse.wheel(dx, dy);
    },

    // -------------------------------------------------------------- wait
    async waitSelector(tabId, selector, timeoutMs) {
      try {
        await tabPage(tabId).waitForSelector(selector, { timeout: timeoutMs });
      } catch {
        throw new BrowserError(
          BROWSER_ERROR_CODES.WAIT_TIMEOUT,
          `selector "${selector}" did not appear within ${timeoutMs}ms`,
          { selector, timeoutMs },
          true, // T6: retryable
        );
      }
    },

    async waitTime(ms) {
      await sleep(ms);
    },

    // ---------------------------------------------------------- screenshot
    async screenshot(tabId, opts) {
      const page = tabPage(tabId);
      const buffer = await page.screenshot({
        fullPage: opts.fullPage ?? false,
        type: opts.format ?? "png",
        quality: opts.quality,
      });
      const bytes = buffer.length;
      const format = opts.format ?? "png";
      const forceMode = opts.mode;
      if (bytes <= INLINE_BYTE_CAP && forceMode !== "resource") {
        return { format, bytes, data: buffer.toString("base64"), mode: "inline" };
      }
      if (forceMode === "inline") {
        // T3: forced inline + oversize is a hard misuse error (not retryable)
        throw new BrowserError(
          BROWSER_ERROR_CODES.SCREENSHOT_TOO_LARGE,
          `screenshot is ${bytes} bytes, above the 256 KiB inline cap`,
          { bytes, cap: INLINE_BYTE_CAP },
        );
      }
      const resourceId = `shot-${tabId}-${Date.now()}.${format}`;
      await writeFile(`${state.resourceDir}/${resourceId}`, buffer);
      return { format, bytes, resourceId, mode: "resource" };
    },

    // ----------------------------------------------------------------- kill
    // Q4 test/ops seam: CDP-driven SIGKILL (cdp.ts). The resulting
    // `disconnected` event marks the session dead.
    async kill() {
      await cdpKillBrowser(refs?.browser ?? null);
    },
  };
}
