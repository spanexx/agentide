/*
 * Code Map: capability handlers — the plugin entry shape
 * `{ [cap]: async (input, ctx) => result }` (plugin-manager BI[8a]).
 *
 * Everything here is plain data (driver-first, T1). Handlers resolve
 * the per-session Session from ctx.sessionId, then call the driver.
 * BrowserError code + retryable propagate up and ride the F10 envelope
 * extension (plugin-manager/gateway-core preserve originalErrorCode +
 * retryable in details).
 *
 * Key behaviors:
 * - F2: navigate targets an existing tab (default most-recently-active),
 *   never auto-opens; newTab:true opens fresh (F1 counter).
 * - F7: different-url navigate on a tab with registered caps ->
 *   NAVIGATION_DESTRUCTIVE (retryable:false); same-url passes.
 * - F8: query returns reusable addresses; instance is 1-based.
 * - T3: screenshot inline vs resource (256 KiB) via driver.
 * - T6: wait selector 30s default / 120s cap.
 *
 * CID Index:
 * CID:handlers-001 -> createHandlers
 * CID:handlers-002 -> browser.navigate (F2/F7 + snapshot)
 * CID:handlers-003 -> browser.launch
 * CID:handlers-004 -> browser.close (tab-only vs teardown, F3)
 * CID:handlers-005 -> capability.list (Q5/F9: registry untouched)
 *
 * Quick lookup: rg -n "CID:handlers-" packages/browser-runtime/src/handlers.ts
 */

import type { Session } from "./session.js";
import type {
  CapabilityListInput,
  CapabilityListOutput,
  ClickInput,
  CloseInput,
  LaunchInput,
  LaunchOutput,
  NavigateInput,
  NavigateOutput,
  QueryInput,
  QueryOutput,
  ScreenshotInput,
  ScreenshotOutput,
  ScrollInput,
  TabCloseInput,
  TabOpenInput,
  TabOpenOutput,
  TabSwitchInput,
  TabSwitchOutput,
  TypeInput,
  WaitInput,
} from "./types.js";
import { BROWSER_ERROR_CODES, BrowserError } from "./types.js";
import { resolveTabId } from "./session.js";
import { captureSnapshot } from "./snapshot.js";

/** Plugin dispatch ctx (plugin-manager handleInvocation). */
export interface HandlerContext {
  readonly pluginId: string;
  readonly sessionId: string | undefined;
}

/** Handler signature (plugin entry shape). */
export type CapabilityHandler = (input: JsonValue, ctx: HandlerContext) => Promise<JsonValue>;

/** JSON-compatible payload (check-banned-types: no `unknown` outside catch).
 * undefined allowed for optional props; JSON.stringify drops them. */
export type JsonValue =
  | string
  | number
  | boolean
  | null
  | undefined
  | readonly JsonValue[]
  | { readonly [key: string]: JsonValue };

/** Resolves the Session for a sessionId (creates on first use). */
export interface SessionRegistry {
  getOrCreate(sessionId: string | undefined): Session;
}

const WAIT_DEFAULT_MS = 30_000; // T6
const WAIT_CAP_MS = 120_000; // T6

function asInput<T>(input: JsonValue): T {
  return input as T;
}

// CID:handlers-001 - createHandlers
// Purpose: build the full handler map (12 manifest caps + capability.list)
//   bound to a session registry.
// Uses: SessionRegistry, Session, BrowserDriver, captureSnapshot
// Used by: index.ts (plugin entry default export)
export function createHandlers(registry: SessionRegistry): Record<string, CapabilityHandler> {
  // resolveSession: per-invocation session (ctx.sessionId; undefined -> default)
  function resolveSession(ctx: HandlerContext): Session {
    return registry.getOrCreate(ctx.sessionId);
  }

  async function navigateHandler(
    input: JsonValue,
    ctx: HandlerContext,
  ): Promise<NavigateOutput> {
    const req = asInput<NavigateInput>(input);
    const { state, driver } = resolveSession(ctx);

    // F2: newTab:true opens a fresh tab (F1 counter); otherwise target an
    // existing tab (default most-recently-active) — never auto-open.
    const tabId = req.newTab === true ? await driver.openTab() : resolveTabId(state, req.tabId);

    // F7 guard: different-url navigate on a tab with registered caps is
    // destructive (page state + sdk-browser coupling lost); same-url
    // re-navigate and fresh tabs (no caps) pass.
    const tab = state.tabs.get(tabId);
    if (tab !== undefined && tab.capabilities.length > 0 && tab.url !== req.url) {
      throw new BrowserError(
        BROWSER_ERROR_CODES.NAVIGATION_DESTRUCTIVE,
        `navigating tab ${tabId} away from ${tab.url} would drop ${tab.capabilities.length} registered caps; use newTab: true`,
        { tabId, from: tab.url, to: req.url, caps: tab.capabilities.length },
      );
    }

    const { url } = await driver.navigate(tabId, req.url, {
      waitUntil: req.waitUntil,
      timeoutMs: req.timeoutMs,
    });

    // F11: DOM-read settle (capsSettled) — T4 sync point
    const settled = await captureSnapshot(state, driver, tabId);
    return { tabId, url, capabilities: settled.capabilities, capsSettled: settled.capsSettled };
  }

  async function launchHandler(input: JsonValue, ctx: HandlerContext): Promise<LaunchOutput> {
    const req = asInput<LaunchInput>(input);
    const { driver } = resolveSession(ctx);
    const mode = req.mode ?? "headless";
    await driver.launch(mode);
    return { launched: true, mode };
  }

  async function closeHandler(input: JsonValue, ctx: HandlerContext): Promise<{ closed: true }> {
    const req = asInput<CloseInput>(input);
    const { driver } = resolveSession(ctx);
    if (req.tabId !== undefined) {
      // F3: tab-only close keeps the context alive
      await driver.closeTab(req.tabId);
      return { closed: true };
    }
    // Omitted tabId: session-end teardown (never kills shared process)
    await driver.close();
    return { closed: true };
  }

  async function tabOpenHandler(input: JsonValue, ctx: HandlerContext): Promise<TabOpenOutput> {
    const req = asInput<TabOpenInput>(input);
    const { driver } = resolveSession(ctx);
    const tabId = await driver.openTab();
    if (req.url !== undefined) {
      await driver.navigate(tabId, req.url, {});
    }
    return { tabId };
  }

  async function tabSwitchHandler(input: JsonValue, ctx: HandlerContext): Promise<TabSwitchOutput> {
    const req = asInput<TabSwitchInput>(input);
    const { driver } = resolveSession(ctx);
    await driver.switchTab(req.tabId);
    return { tabId: req.tabId };
  }

  async function tabCloseHandler(input: JsonValue, ctx: HandlerContext): Promise<{ closed: true }> {
    const req = asInput<TabCloseInput>(input);
    const { driver } = resolveSession(ctx);
    await driver.closeTab(req.tabId);
    return { closed: true };
  }

  async function capabilityListHandler(
    input: JsonValue,
    ctx: HandlerContext,
  ): Promise<CapabilityListOutput> {
    const req = asInput<CapabilityListInput>(input);
    const { state, driver } = resolveSession(ctx);
    // Q5/F9: answered from the per-tab DOM-read snapshot; the shipped
    // capability-registry is never touched. No-arg -> active tab.
    const tabId = resolveTabId(state, req.tabId);
    const snapshot = await captureSnapshot(state, driver, tabId);
    return { capabilities: snapshot.capabilities, capsSettled: snapshot.capsSettled };
  }

  async function clickHandler(input: JsonValue, ctx: HandlerContext): Promise<{ clicked: true }> {
    const req = asInput<ClickInput>(input);
    const { state, driver } = resolveSession(ctx);
    const tabId = resolveTabId(state, req.tabId);
    await driver.click(tabId, req.selector, { instance: req.instance, button: req.button });
    return { clicked: true };
  }

  async function typeHandler(input: JsonValue, ctx: HandlerContext): Promise<{ typed: true; text: string }> {
    const req = asInput<TypeInput>(input);
    const { state, driver } = resolveSession(ctx);
    const tabId = resolveTabId(state, req.tabId);
    await driver.type(tabId, req.selector, req.text, { instance: req.instance, delayMs: req.delayMs });
    return { typed: true, text: req.text };
  }

  async function scrollHandler(input: JsonValue, ctx: HandlerContext): Promise<{ scrolled: true }> {
    const req = asInput<ScrollInput>(input);
    const { state, driver } = resolveSession(ctx);
    const tabId = resolveTabId(state, req.tabId);
    await driver.scroll(tabId, { direction: req.direction, px: req.px, selector: req.selector });
    return { scrolled: true };
  }

  async function waitHandler(input: JsonValue, ctx: HandlerContext): Promise<{ waited: true }> {
    const req = asInput<WaitInput>(input);
    const { state, driver } = resolveSession(ctx);
    if (req.wait === "selector") {
      const timeoutMs = Math.min(req.timeoutMs ?? WAIT_DEFAULT_MS, WAIT_CAP_MS); // T6 cap
      const tabId = resolveTabId(state, req.tabId);
      await driver.waitSelector(tabId, req.selector ?? "", timeoutMs);
      return { waited: true };
    }
    await driver.waitTime(req.ms ?? 0);
    return { waited: true };
  }

  async function screenshotHandler(
    input: JsonValue,
    ctx: HandlerContext,
  ): Promise<ScreenshotOutput> {
    const req = asInput<ScreenshotInput>(input);
    const { state, driver } = resolveSession(ctx);
    const tabId = resolveTabId(state, req.tabId);
    return driver.screenshot(tabId, {
      fullPage: req.fullPage,
      format: req.format,
      quality: req.quality,
      mode: req.mode,
    });
  }

  async function queryHandler(input: JsonValue, ctx: HandlerContext): Promise<QueryOutput> {
    const req = asInput<QueryInput>(input);
    const { state, driver } = resolveSession(ctx);
    const tabId = resolveTabId(state, req.tabId);
    return driver.query(tabId, req.selector);
  }

  return {
    "browser.launch": launchHandler,
    "browser.navigate": navigateHandler,
    "browser.click": clickHandler,
    "browser.type": typeHandler,
    "browser.scroll": scrollHandler,
    "browser.wait": waitHandler,
    "browser.screenshot": screenshotHandler,
    "browser.query": queryHandler,
    "browser.close": closeHandler,
    "browser.tab.open": tabOpenHandler,
    "browser.tab.switch": tabSwitchHandler,
    "browser.tab.close": tabCloseHandler,
    // 13th handler: NOT in the manifest caps list — answers the per-tab
    // DOM-read snapshot (Q5). Registered by the gateway as a platform
    // capability owned by the browser-runtime plugin.
    "capability.list": capabilityListHandler,
  };
}
