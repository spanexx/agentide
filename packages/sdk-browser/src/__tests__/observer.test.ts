/** @vitest-environment jsdom */
/**
 * Phase 2 — observation & count-based dedup (GRILL T2).
 *
 * The DOM is the manifest: `createSdk` scans `observeRoot` (default
 * `document.body`) and watches it with a `MutationObserver` filtering on
 * `data-sdk-cap` only (attributeFilter is load-bearing — it avoids an
 * attribute-change storm from unrelated attributes).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  CAP_ATTR,
  CapRegistry,
  capName,
  scanRoot,
  watchCaps,
} from "../observer.js";

/** jsdom's MutationObserver delivers callbacks on a microtask queue. */
const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

let doc: Document;

beforeEach(() => {
  doc = document.implementation.createHTMLDocument("test");
  document.body.innerHTML = "";
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("capName", () => {
  it("reads the data-sdk-cap attribute", () => {
    const el = doc.createElement("div");
    el.setAttribute(CAP_ATTR, "shop.cart.add");
    expect(capName(el)).toBe("shop.cart.add");
  });

  it("returns null when the attribute is missing or empty", () => {
    const el = doc.createElement("div");
    expect(capName(el)).toBeNull();
    el.setAttribute(CAP_ATTR, "");
    expect(capName(el)).toBeNull();
  });
});

describe("CapRegistry (count-based dedup, GRILL T2 Q4)", () => {
  it("counts three annotated elements of the same name as count=3", () => {
    const reg = new CapRegistry();
    for (let i = 0; i < 3; i++) {
      const el = doc.createElement("button");
      el.setAttribute(CAP_ATTR, "shop.cart.add");
      reg.add(el);
    }
    const view = reg.get("shop.cart.add");
    expect(view?.count).toBe(3);
  });

  it("does not double-count the same element added twice", () => {
    const reg = new CapRegistry();
    const el = doc.createElement("button");
    el.setAttribute(CAP_ATTR, "shop.cart.add");
    expect(reg.add(el)).toBe(true);
    expect(reg.add(el)).toBe(false);
    expect(reg.get("shop.cart.add")?.count).toBe(1);
  });

  it("unregisters 1→0 when the last element is removed", () => {
    const reg = new CapRegistry();
    const a = doc.createElement("button");
    const b = doc.createElement("button");
    a.setAttribute(CAP_ATTR, "shop.cart.add");
    b.setAttribute(CAP_ATTR, "shop.cart.add");
    reg.add(a);
    reg.add(b);
    expect(reg.remove(a, "shop.cart.add")).toBe(true);
    expect(reg.get("shop.cart.add")?.count).toBe(1);
    expect(reg.remove(b, "shop.cart.add")).toBe(true);
    expect(reg.get("shop.cart.add")).toBeUndefined();
  });

  it("defaults tier/version from the constructor options", () => {
    const reg = new CapRegistry("read", "2.0.0");
    const el = doc.createElement("button");
    el.setAttribute(CAP_ATTR, "shop.cart.add");
    reg.add(el);
    const view = reg.get("shop.cart.add");
    expect(view?.tier).toBe("read");
    expect(view?.version).toBe("2.0.0");
  });
});

describe("scanRoot (initial scan on createSdk, GRILL T2)", () => {
  it("finds annotated elements and ignores non-annotated ones", () => {
    doc.body.innerHTML = `
      <div data-sdk-cap="shop.cart.add"></div>
      <div></div>
      <section><span data-sdk-cap="shop.cart.remove"></span></section>
    `;
    const found = scanRoot(doc.body);
    expect(found.map((c) => c.name).sort()).toEqual([
      "shop.cart.add",
      "shop.cart.remove",
    ]);
  });

  it("registers every annotated element into the registry", () => {
    doc.body.innerHTML = `
      <button data-sdk-cap="shop.cart.add">A</button>
      <button data-sdk-cap="shop.cart.add">B</button>
      <button data-sdk-cap="shop.cart.add">C</button>
    `;
    const reg = new CapRegistry();
    scanRoot(doc.body).forEach((c) => reg.add(c.el));
    expect(reg.get("shop.cart.add")?.count).toBe(3);
  });
});

describe("watchCaps (MutationObserver, GRILL T2)", () => {
  it("fires on attribute change of data-sdk-cap", async () => {
    const el = doc.createElement("div");
    el.setAttribute(CAP_ATTR, "shop.cart.add");
    doc.body.appendChild(el);

    const reg = new CapRegistry();
    const onChange = vi.fn();
    const stop = watchCaps(doc.body, reg, onChange);
    reg.add(el);

    el.setAttribute(CAP_ATTR, "shop.cart.remove");
    await flush();

    expect(onChange).toHaveBeenCalledWith("shop.cart.remove", expect.objectContaining({ count: 1 }));
    expect(reg.get("shop.cart.add")).toBeUndefined();
    expect(reg.get("shop.cart.remove")?.count).toBe(1);
    stop();
  });

  it("unregisters when the attribute is removed entirely", async () => {
    const el = doc.createElement("div");
    el.setAttribute(CAP_ATTR, "shop.cart.add");
    doc.body.appendChild(el);

    const reg = new CapRegistry();
    const onChange = vi.fn();
    const stop = watchCaps(doc.body, reg, onChange);
    reg.add(el);

    el.removeAttribute(CAP_ATTR);
    await flush();

    expect(reg.get("shop.cart.add")).toBeUndefined();
    stop();
  });

  it("detects new annotated elements appended to the DOM", async () => {
    const reg = new CapRegistry();
    const onChange = vi.fn();
    const stop = watchCaps(doc.body, reg, onChange);

    const el = doc.createElement("button");
    el.setAttribute(CAP_ATTR, "shop.cart.add");
    doc.body.appendChild(el);
    await flush();

    expect(onChange).toHaveBeenCalledWith("shop.cart.add", expect.objectContaining({ count: 1 }));
    expect(reg.get("shop.cart.add")?.count).toBe(1);
    stop();
  });

  it("unregisters elements removed from the DOM", async () => {
    const el = doc.createElement("button");
    el.setAttribute(CAP_ATTR, "shop.cart.add");
    doc.body.appendChild(el);

    const reg = new CapRegistry();
    const onChange = vi.fn();
    const stop = watchCaps(doc.body, reg, onChange);
    reg.add(el);

    el.remove();
    await flush();

    expect(onChange).toHaveBeenCalledWith("shop.cart.add", expect.objectContaining({ count: 0 }));
    expect(reg.get("shop.cart.add")).toBeUndefined();
    stop();
  });

  it("stops notifying after the returned cleanup is called", async () => {
    const el = doc.createElement("button");
    doc.body.appendChild(el);

    const reg = new CapRegistry();
    const onChange = vi.fn();
    const stop = watchCaps(doc.body, reg, onChange);

    el.setAttribute(CAP_ATTR, "shop.cart.add");
    await flush();
    expect(onChange).toHaveBeenCalledTimes(1);

    stop();
    el.setAttribute(CAP_ATTR, "shop.cart.remove");
    await flush();
    expect(onChange).toHaveBeenCalledTimes(1);
  });
});
