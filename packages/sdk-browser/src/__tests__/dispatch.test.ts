/** @vitest-environment jsdom */
/**
 * Phase 3 — invocation dispatch (GRILL T2 Q5).
 *
 * A Gateway `sdk.invoke` fans out as `CustomEvent("sdk:cap:<name>")` on
 * every annotated element, with `detail = { input, ctx: { token } }` (the
 * JWT verbatim). Developers filter with `e.target.closest('[data-sdk-cap=…]')`.
 * Form-fill fallback: unless a dev listener calls `preventDefault()`, the
 * SDK writes `input.text` into an annotated input element.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CapRegistry } from "../observer.js";
import { dispatchInvoke } from "../dispatch.js";

const TOKEN =
  "eyJhbGciOiJIUzI1NiJ9.eyJleHBlY3RlZE9yaWdpbnMiOlsiaHR0cHM6Ly9zaG9wLmFjbWUuY29tIl19.sig";

let doc: Document;
let registry: CapRegistry;

beforeEach(() => {
  doc = document.implementation.createHTMLDocument("test");
  document.body.innerHTML = "";
  registry = new CapRegistry();
});

afterEach(() => {
  vi.restoreAllMocks();
});

/** Annotate an element and track it in the registry. */
function annotate(name: string, tag = "div"): Element {
  const el = doc.createElement(tag);
  el.setAttribute("data-sdk-cap", name);
  document.body.appendChild(el);
  registry.add(el);
  return el;
}

describe("dispatchInvoke (fan-out, GRILL T2 Q5)", () => {
  it("dispatches sdk:cap:<name> on every annotated element", () => {
    const els = [annotate("shop.cart.add"), annotate("shop.cart.add"), annotate("shop.cart.add")];
    const seen: Element[] = [];
    for (const el of els) {
      el.addEventListener("sdk:cap:shop.cart.add", () => seen.push(el));
    }
    const ok = dispatchInvoke(els, "shop.cart.add", { productId: 202, qty: 2 }, TOKEN);
    expect(ok).toBe(true);
    expect(seen).toHaveLength(3);
  });

  it("carries detail { input, ctx: { token } } with the JWT verbatim", () => {
    const el = annotate("shop.cart.add");
    let detail: unknown;
    el.addEventListener("sdk:cap:shop.cart.add", (e) => {
      detail = (e as CustomEvent).detail;
    });
    dispatchInvoke([el], "shop.cart.add", { productId: 202 }, TOKEN);
    expect(detail).toEqual({
      input: { productId: 202 },
      ctx: { token: TOKEN },
    });
  });

  it("lets a dev listener filter with e.target.closest('[data-sdk-cap=…]')", () => {
    document.body.innerHTML = `
      <div id="list">
        <div data-sdk-cap="shop.cart.add" data-pid="101"></div>
        <div data-sdk-cap="shop.cart.add" data-pid="202"></div>
        <div data-sdk-cap="shop.cart.add" data-pid="303"></div>
      </div>
    `;
    const els = [
      ...document.body.querySelectorAll('[data-sdk-cap="shop.cart.add"]'),
    ];
    els.forEach((el) => registry.add(el));

    const matches: number[] = [];
    document.addEventListener("sdk:cap:shop.cart.add", (e) => {
      const card = (e.target as Element).closest('[data-sdk-cap="shop.cart.add"]');
      if (card?.getAttribute("data-pid") === "202") {
        matches.push(202);
      }
    });

    dispatchInvoke(els, "shop.cart.add", { productId: 202, qty: 2 }, TOKEN);
    expect(matches).toEqual([202]);
  });

  it("returns false and dispatches nothing for an unknown capability", () => {
    const seen = vi.fn();
    document.addEventListener("sdk:cap:nope", seen);
    const ok = dispatchInvoke([], "nope", {}, TOKEN);
    expect(ok).toBe(false);
    expect(seen).not.toHaveBeenCalled();
  });
});

describe("form-fill fallback (GRILL T1 / PRD Scenario 4)", () => {
  it("writes input.text into an annotated input when nothing prevented", () => {
    const input = annotate("profile.note", "input") as HTMLInputElement;
    const ok = dispatchInvoke([input], "profile.note", { text: "hi" }, TOKEN);
    expect(ok).toBe(true);
    expect(input.value).toBe("hi");
  });

  it("does nothing when a dev listener calls preventDefault()", () => {
    const input = annotate("profile.note", "input") as HTMLInputElement;
    // Document-level listeners persist across tests in the same jsdom
    // environment — remove it here so later tests don't inherit the veto.
    const veto = (e: Event) => e.preventDefault();
    document.addEventListener("sdk:cap:profile.note", veto);
    dispatchInvoke([input], "profile.note", { text: "hi" }, TOKEN);
    expect(input.value).toBe("");
    document.removeEventListener("sdk:cap:profile.note", veto);
  });

  it("ignores non-input annotated elements for form-fill", () => {
    const el = annotate("shop.cart.add", "div");
    const spy = vi.spyOn(el, "dispatchEvent");
    dispatchInvoke([el], "shop.cart.add", { text: "hi" }, TOKEN);
    expect(spy).toHaveBeenCalledTimes(1);
    // Still dispatched the CustomEvent (the div is a valid dispatch target).
    expect(spy.mock.calls[0][0] instanceof CustomEvent).toBe(true);
  });

  it("still fills when input.text is a plain string payload", () => {
    const input = annotate("profile.note", "input") as HTMLInputElement;
    dispatchInvoke([input], "profile.note", "hi", TOKEN);
    expect(input.value).toBe("hi");
  });
});
