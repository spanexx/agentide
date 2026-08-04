/**
 * Phase 3 — invocation dispatch (GRILL T2 Q5).
 *
 * A Gateway `sdk.invoke` is fanned out as `CustomEvent("sdk:cap:<name>")` on
 * every element annotated with that name. `detail` carries the invocation
 * input plus `ctx: { token }` (the JWT verbatim, GRILL T5 Q3). Developers
 * handle it with a plain document-level listener and `closest()`.
 *
 * Form-fill fallback (GRILL T1): unless a listener calls `preventDefault()`
 * on the CustomEvent, an annotated input element gets `input.text` written
 * into its value — the zero-code path for "leave a note" style caps.
 */

import type { BackendValue } from "@spanexx/backend-runtime";
import type { InvocationDetail } from "./types";

/**
 * Input-like elements the form-fill fallback will write into.
 *
 * Tag-name check (not `instanceof`) so elements created in a different
 * realm — e.g. jsdom `createHTMLDocument` or an iframe — still qualify.
 * The type predicate is a compile-time-only claim; the runtime test is
 * realm-safe.
 */
function isFillable(el: Element): el is HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement {
  const tag = el.tagName.toLowerCase();
  return tag === "input" || tag === "textarea" || tag === "select";
}

/** Coerce the payload to the text written into the field (input.text). */
function fillText(input: BackendValue): string | null {
  if (typeof input === "string") return input;
  if (input !== null && typeof input === "object") {
    // Cast is checked at runtime: only a string value is ever used.
    const text = (input as { text?: string }).text;
    if (typeof text === "string") return text;
  }
  return null;
}

/**
 * Fan out an invocation. Returns true when at least one annotated element
 * received the event. `ctx.token` is the JWT verbatim — never touched.
 */
export function dispatchInvoke(
  els: Element[],
  name: string,
  input: BackendValue,
  token: string,
): boolean {
  if (els.length === 0) return false;

  const detail: InvocationDetail = { input, ctx: { token } };
  for (const el of els) {
    const event = new CustomEvent(`sdk:cap:${name}`, {
      detail,
      bubbles: true,
      cancelable: true,
    });
    el.dispatchEvent(event);

    // Form-fill fallback: only when no dev listener vetoed the event.
    if (!event.defaultPrevented) {
      const text = fillText(input);
      if (text !== null && isFillable(el)) {
        el.value = text;
      }
    }
  }
  return true;
}
