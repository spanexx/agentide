/*
 * Code Map: structured errors for the browser runtime.
 *
 * IMPL deliverable (Phase 3): the home of BrowserError and the
 * BROWSER_* code table. types.ts re-exports these so driver/session
 * imports stay unchanged.
 *
 * Retryable policy (capability-contracts.md T2 + F7/F8/Q4):
 *   retryable:true  -> WAIT_TIMEOUT, SELECTOR_NOT_FOUND,
 *                      SELECTOR_TIMEOUT, NAVIGATION_TIMEOUT,
 *                      LAUNCH_FAILED, CRASHED
 *   retryable:false -> NO_CONTEXT, ALREADY_LAUNCHED, TAB_NOT_FOUND,
 *                      CLOSED, NAVIGATION_FAILED, SELECTOR_AMBIGUOUS,
 *                      NAVIGATION_DESTRUCTIVE, SCREENSHOT_TOO_LARGE
 * (F10 envelope extension carries code + retryable through the plugin
 * dispatch path; callers match on details.browserCode.)
 *
 * CID Index:
 * CID:errors-001 -> BrowserError
 * CID:errors-002 -> BROWSER_ERROR_CODES
 *
 * Quick lookup: rg -n "CID:errors-" packages/browser-runtime/src/errors.ts
 */

// CID:errors-001 - BrowserError
// Purpose: structured handler error carrying code + retryable + details.
// Uses: nothing (self-contained)
// Used by: driver, session, handlers, index
export class BrowserError extends Error {
  public readonly code: string;
  public readonly retryable: boolean;
  public readonly details: Readonly<Record<string, string | number | boolean | null>>;

  constructor(
    code: string,
    message: string,
    details: Readonly<Record<string, string | number | boolean | null>> = {},
    retryable = false,
  ) {
    super(message);
    this.name = "BrowserError";
    this.code = code;
    this.details = details;
    this.retryable = retryable;
  }
}

// CID:errors-002 - BROWSER_ERROR_CODES
// Purpose: canonical BROWSER_* code table (capability-contracts.md).
// Uses: nothing
// Used by: driver, session, handlers, tests
export const BROWSER_ERROR_CODES = {
  NO_CONTEXT: "BROWSER_NO_CONTEXT",
  ALREADY_LAUNCHED: "BROWSER_ALREADY_LAUNCHED",
  LAUNCH_FAILED: "BROWSER_LAUNCH_FAILED",
  CRASHED: "BROWSER_CRASHED",
  CLOSED: "BROWSER_CLOSED",
  TAB_NOT_FOUND: "BROWSER_TAB_NOT_FOUND",
  NAVIGATION_TIMEOUT: "BROWSER_NAVIGATION_TIMEOUT",
  NAVIGATION_FAILED: "BROWSER_NAVIGATION_FAILED",
  NAVIGATION_DESTRUCTIVE: "BROWSER_NAVIGATION_DESTRUCTIVE",
  SELECTOR_NOT_FOUND: "BROWSER_SELECTOR_NOT_FOUND",
  SELECTOR_TIMEOUT: "BROWSER_SELECTOR_TIMEOUT",
  SELECTOR_AMBIGUOUS: "BROWSER_SELECTOR_AMBIGUOUS",
  WAIT_TIMEOUT: "BROWSER_WAIT_TIMEOUT",
  SCREENSHOT_TOO_LARGE: "BROWSER_SCREENSHOT_TOO_LARGE",
} as const;

/** Retryable table in machine form (F10 envelope retryable flag). */
export const RETRYABLE_ERROR_CODES: ReadonlySet<string> = new Set([
  BROWSER_ERROR_CODES.WAIT_TIMEOUT,
  BROWSER_ERROR_CODES.SELECTOR_NOT_FOUND,
  BROWSER_ERROR_CODES.SELECTOR_TIMEOUT,
  BROWSER_ERROR_CODES.NAVIGATION_TIMEOUT,
  BROWSER_ERROR_CODES.LAUNCH_FAILED,
  BROWSER_ERROR_CODES.CRASHED,
]);

/** True when a BrowserError is safe to retry (F10 retryable policy). */
export function isRetryableError(err: BrowserError): boolean {
  return RETRYABLE_ERROR_CODES.has(err.code);
}
