/*
 * Code Map: F8 address resolution — both directions.
 *
 * 1. Node-side: `resolveLocator` turns a (selector, instance) pair into
 *    a Playwright Locator, applying 1-based addressing and the
 *    AMBIGUOUS / NOT_FOUND rules used by click/type/scroll.
 * 2. Browser-side: `computeAddressesForSelector` is the in-page
 *    function passed to `page.evaluate(...)`. It walks each matched
 *    element, climbs to the first data-* attr, and emits a
 *    reusable CSS address — self-anchored when the element itself
 *    carries the attr, ancestor+selector when only an ancestor
 *    does, `tag:nth-of-type(n)` for data-less elements.
 *
 * The two halves share the F8 invariant: every address is reusable
 * verbatim in click/type. The address algorithm is the
 * capability-contracts F8 spec, lifted out of driver.ts so the
 * Playwright adapter stays under the 350-line/file rule.
 *
 * CID Index:
 * CID:address-001 -> resolveLocator
 * CID:address-002 -> computeAddressesForSelector
 *
 * Quick lookup: rg -n "CID:address-" packages/browser-runtime/src/address.ts
 */

import type { Page } from "playwright-core";
import { BROWSER_ERROR_CODES, BrowserError } from "./types.js";

// CID:address-001 - resolveLocator
// Purpose: 1-based instance addressing (F8). >1 match without instance
//   -> AMBIGUOUS; 0 matches -> NOT_FOUND (retryable). Out-of-range
//   instance -> NOT_FOUND (retryable). Waits briefly for the selector
//   to appear (SELECTOR_TIMEOUT on cap).
// Uses: playwright Page.locator (async — count() is a Promise)
// Used by: driver.ts (click/type/scroll)
export async function resolveLocator(
  page: Page,
  selector: string,
  instance: number | undefined,
): Promise<ReturnType<Page["locator"]>> {
  const count = await page.locator(selector).count();
  if (count === 0) {
    throw new BrowserError(
      BROWSER_ERROR_CODES.SELECTOR_NOT_FOUND,
      `selector "${selector}" not found`,
      { selector },
      true,
    );
  }
  if (count > 1 && instance === undefined) {
    throw new BrowserError(
      BROWSER_ERROR_CODES.SELECTOR_AMBIGUOUS,
      `selector "${selector}" matches ${count} elements; pass instance (1-based)`,
      { selector, matches: count },
    );
  }
  const idx = instance === undefined ? 0 : instance - 1;
  if (idx >= count) {
    throw new BrowserError(
      BROWSER_ERROR_CODES.SELECTOR_NOT_FOUND,
      `selector "${selector}" has no instance ${instance}`,
      { selector, matches: count, instance: instance ?? null },
      true,
    );
  }
  return page.locator(selector).nth(idx);
}

// CID:address-002 - computeAddressesForSelector
// Purpose: F8 — emit one reusable CSS address per matched element.
//   Run inside `page.evaluate(...)`, so DOM globals are valid. The
//   address must be a selector that resolves the same element when
//   fed back into click/type.
//   1. self has data-* -> `tag[attr]`
//   2. ancestor has data-* -> `ancestorTag[attr] ${sel}`
//   3. data-less -> `tag:nth-of-type(n)` (1-based among same-tag
//      siblings so the address stays stable under DOM edits before
//      the click).
// Uses: document, Element
// Used by: driver.ts (query) — passed as the page.evaluate function
export function computeAddressesForSelector(sel: string): string[] {
  const els = document.querySelectorAll(sel);
  const out: string[] = [];
  for (const el of els) {
    let anchor: Element | null = el;
    let attr: string | null = null;
    while (anchor !== null && anchor !== document.body.parentElement) {
      for (const a of anchor.attributes) {
        if (a.name.startsWith("data-")) {
          attr = `${a.name}="${a.value}"`;
          break;
        }
      }
      if (attr !== null) break;
      anchor = anchor.parentElement;
    }
    if (attr !== null && anchor !== null && anchor === el) {
      out.push(`${anchor.tagName.toLowerCase()}[${attr}]`);
    } else if (attr !== null && anchor !== null) {
      out.push(`${anchor.tagName.toLowerCase()}[${attr}] ${sel}`);
    } else {
      // data-less element: nth-of-type within its parent so the
      // address stays reusable (capability-contracts F8)
      const tag = el.tagName.toLowerCase();
      const siblings = Array.from(el.parentElement?.children ?? []);
      const nth = siblings.filter((s) => s.tagName.toLowerCase() === tag).indexOf(el) + 1;
      out.push(`${tag}:nth-of-type(${nth})`);
    }
  }
  return out;
}
