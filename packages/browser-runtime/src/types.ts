/*
 * Code Map: browser-runtime types
 * - BrowserDriver: plain-data driver interface (driver-first rule, T1) —
 *   zero Playwright types leak into the public surface
 * - TabState / SessionState: per-tab + per-session state shapes
 * - BrowserError: structured error carrying BROWSER_* code + retryable
 *   (feeds the AUDIT F10 envelope extension)
 * - Input/Output payloads for the 12 capabilities (capability-contracts.md)
 *
 * CID Index:
 * CID:types-001 -> BrowserDriver
 * CID:types-002 -> SessionState
 * CID:types-003 -> BrowserError
 * CID:types-004 -> capability payloads
 *
 * Quick lookup: rg -n "CID:types-" packages/browser-runtime/src/types.ts
 */

/** One registered on-page capability in a tab's snapshot (mirrors
 * sdk-browser's CapabilityView: name/tier/version/count/registered). */
export type CapabilitySnapshot = {
  readonly name: string;
  readonly tier: "read" | "act" | "destructive";
  readonly version: string;
  readonly count: number;
  readonly registered: boolean;
}

/** Per-tab runtime state. capabilities = per-tab cap snapshot captured
 * at navigate (Q5-revision runtime-snapshot model — the shipped
 * capability-registry is NOT modified). */
export interface TabState {
  readonly id: number;
  readonly url: string;
  readonly capabilities: readonly CapabilitySnapshot[];
  readonly capsSettled: boolean;
}

/** Per-session runtime state. One Chromium process + one BrowserContext
 * per session (T1); ids increment per context and are never reused (F1);
 * fresh context after crash-relaunch resets the counter. */
export interface SessionState {
  launched: boolean;
  mode: "headless" | "headed";
  dead: boolean;
  tabs: Map<number, TabState>;
  activeTabId: number;
  nextTabId: number;
  resourceDir: string;
}

// =============================================================================
// CID:types-001 - BrowserDriver
// =============================================================================
/** Plain-data driver interface. The Playwright adapter (driver.ts)
 * implements this; handlers depend only on these shapes. */
export interface BrowserDriver {
  launch(mode: "headless" | "headed"): Promise<void>;
  close(): Promise<void>;
  openTab(): Promise<number>;
  closeTab(tabId: number): Promise<void>;
  switchTab(tabId: number): Promise<void>;
  navigate(
    tabId: number,
    url: string,
    opts: {
      newTab?: boolean;
      waitUntil?: "load" | "domcontentloaded" | "networkidle";
      timeoutMs?: number;
    },
  ): Promise<{ url: string }>;
  readCaps(tabId: number): Promise<{ capabilities: readonly CapabilitySnapshot[]; capsSettled: boolean }>;
  query(
    tabId: number,
    selector: string,
  ): Promise<{ matches: number; addresses: readonly string[] }>;
  click(
    tabId: number,
    selector: string,
    opts: { instance?: number; button?: "left" | "right" },
  ): Promise<void>;
  type(tabId: number, selector: string, text: string, opts: { instance?: number; delayMs?: number }): Promise<void>;
  scroll(tabId: number, opts: { direction: "up" | "down" | "left" | "right"; px?: number; selector?: string }): Promise<void>;
  waitSelector(tabId: number, selector: string, timeoutMs: number): Promise<void>;
  waitTime(ms: number): Promise<void>;
  screenshot(
    tabId: number,
    opts: { fullPage?: boolean; format?: "png" | "jpeg"; quality?: number; mode?: "inline" | "resource" },
  ): Promise<{ format: "png" | "jpeg"; bytes: number; data?: string; resourceId?: string; mode: "inline" | "resource" }>;
}

// =============================================================================
// CID:types-003 - BrowserError + BROWSER_* codes
// =============================================================================
// Real home: errors.ts (IMPL Phase 3 deliverable). Re-exported here so
// driver/session/handlers can import types only. Retryable table:
// errors.ts RETRYABLE_ERROR_CODES.
export { BrowserError, BROWSER_ERROR_CODES } from "./errors.js";

// =============================================================================
// CID:types-004 - capability input/output payloads (flat JSON, CSS-only
// selectors, numeric tabId — capability-contracts.md)
// =============================================================================

export interface LaunchInput {
  readonly mode?: "headless" | "headed";
}

export type LaunchOutput = {
  readonly launched: true;
  readonly mode: "headless" | "headed";
}

export interface NavigateInput {
  readonly url: string;
  readonly tabId?: number;
  readonly newTab?: boolean;
  readonly waitUntil?: "load" | "domcontentloaded" | "networkidle";
  readonly timeoutMs?: number;
}

export type NavigateOutput = {
  readonly tabId: number;
  readonly url: string;
  readonly capabilities: readonly CapabilitySnapshot[];
  readonly capsSettled: boolean;
}

export interface ClickInput {
  readonly selector: string;
  readonly tabId?: number;
  readonly instance?: number;
  readonly button?: "left" | "right";
}

export interface TypeInput {
  readonly selector: string;
  readonly text: string;
  readonly tabId?: number;
  readonly delayMs?: number;
  readonly instance?: number;
}

export interface ScrollInput {
  readonly direction: "up" | "down" | "left" | "right";
  readonly px?: number;
  readonly tabId?: number;
  readonly selector?: string;
}

export interface WaitInput {
  readonly wait: "selector" | "time";
  readonly selector?: string;
  readonly timeoutMs?: number;
  readonly ms?: number;
  readonly tabId?: number;
}

export interface ScreenshotInput {
  readonly tabId?: number;
  readonly fullPage?: boolean;
  readonly format?: "png" | "jpeg";
  readonly quality?: number;
  readonly mode?: "inline" | "resource";
}

export type ScreenshotOutput = {
  readonly format: "png" | "jpeg";
  readonly mode: "inline" | "resource";
  readonly data?: string;
  readonly resourceId?: string;
  readonly bytes: number;
}

export interface QueryInput {
  readonly selector: string;
  readonly tabId?: number;
}

export type QueryOutput = {
  readonly matches: number;
  readonly addresses: readonly string[];
}

export interface CapabilityListInput {
  readonly tabId?: number;
}

export type CapabilityListOutput = {
  readonly capabilities: readonly CapabilitySnapshot[];
  readonly capsSettled: boolean;
}

export interface CloseInput {
  readonly tabId?: number;
}

export interface TabOpenInput {
  readonly url?: string;
  readonly tabId?: number;
}

export type TabOpenOutput = {
  readonly tabId: number;
}

export interface TabSwitchInput {
  readonly tabId: number;
}

export type TabSwitchOutput = {
  readonly tabId: number;
}

export interface TabCloseInput {
  readonly tabId: number;
}

export type TabCloseOutput = {
  readonly closed: true;
}

export type ClickOutput = {
  readonly clicked: true;
}

export type TypeOutput = {
  readonly typed: true;
  readonly text: string;
}

export type ScrollOutput = {
  readonly scrolled: true;
}

export type WaitOutput = {
  readonly waited: true;
}

export type CloseOutput = {
  readonly closed: true;
}
