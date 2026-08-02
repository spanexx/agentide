/**
 * Phase 2 — observation engine (GRILL T2).
 *
 * The DOM is the manifest: capabilities live on annotated elements, not in a
 * file. This module scans a root for `[data-sdk-cap]` elements, tracks their
 * counts (dedup key), and watches the DOM with a `MutationObserver` whose
 * `attributeFilter` limits it to `data-sdk-cap` changes only.
 *
 * Registration semantics (T2 Q4): count-based — one capability per name;
 * the Gateway sees register on 0→1 and unregister on 1→0. That wiring
 * happens in Phase 5 (registration only while connected); here we track
 * counts and element identity.
 */

import type { CapabilityView } from "./types.js";

/** The single attribute the SDK reads. Everything else in the DOM is noise. */
export const CAP_ATTR = "data-sdk-cap";

/** An annotated element found during a scan. */
export interface CapElement {
  el: Element;
  name: string;
}

/** Read the capability name off an element; null when absent or empty. */
export function capName(el: Element): string | null {
  const value = el.getAttribute(CAP_ATTR);
  if (value === null || value === "") return null;
  return value;
}

/** Capability tracker. One entry per name (T2 Q4). */
export class CapRegistry {
  private counts = new Map<string, number>();
  private els = new Map<string, Set<Element>>();
  private registered = new Set<string>();

  constructor(
    private readonly defaultTier = "act",
    private readonly defaultVersion = "1.0.0",
  ) {}

  /** Track an annotated element. Returns true when the count changed. */
  add(el: Element): boolean {
    const name = capName(el);
    if (name === null) return false;
    let set = this.els.get(name);
    if (set === undefined) {
      set = new Set();
      this.els.set(name, set);
    }
    if (set.has(el)) return false; // dedup: same element observed twice
    set.add(el);
    this.counts.set(name, (this.counts.get(name) ?? 0) + 1);
    return true;
  }

  /** Untrack an element under a known name. Returns true on count change. */
  remove(el: Element, name: string): boolean {
    const set = this.els.get(name);
    if (set === undefined || !set.delete(el)) return false;
    const next = (this.counts.get(name) ?? 1) - 1;
    if (next <= 0) {
      this.counts.delete(name);
      this.els.delete(name);
    } else {
      this.counts.set(name, next);
    }
    return true;
  }

  /** Capability view, or undefined when nothing is tracked for the name. */
  get(name: string): CapabilityView | undefined {
    const count = this.counts.get(name);
    if (count === undefined) return undefined;
    return {
      name,
      tier: this.defaultTier,
      version: this.defaultVersion,
      count,
      registered: this.registered.has(name),
    };
  }

  /** All tracked capabilities. */
  list(): CapabilityView[] {
    return [...this.counts.keys()]
      .map((name) => this.get(name))
      .filter((v): v is CapabilityView => v !== undefined);
  }

  /** Annotated elements for a capability (dispatch targets, T2 Q5). */
  elements(name: string): Element[] {
    return [...(this.els.get(name) ?? [])];
  }

  /** Flip the connection-aware registration flag (Phase 5 wiring). */
  setRegistered(name: string, registered: boolean): void {
    if (registered) this.registered.add(name);
    else this.registered.delete(name);
  }
}

/** Scan a root for annotated elements (initial scan on `createSdk`). */
export function scanRoot(root: Element): CapElement[] {
  const found: CapElement[] = [];
  const visit = (el: Element) => {
    const name = capName(el);
    if (name !== null) found.push({ el, name });
  };
  for (const el of root.querySelectorAll(`[${CAP_ATTR}]`)) visit(el);
  return found;
}

/**
 * Watch a root for capability changes. Applies mutations to the registry and
 * notifies `onChange(name, view)` whenever a count changes. Returns a
 * cleanup that disconnects the observer.
 *
 * attributeFilter is load-bearing: without it, jsdom/browsers would report
 * every attribute mutation (classes, styles, aria-*) and burn cycles.
 */
export function watchCaps(
  root: Element,
  registry: CapRegistry,
  onChange: (name: string, view: CapabilityView) => void,
): () => void {
  const notify = (name: string) => {
    onChange(name, registry.get(name) ?? {
      name,
      tier: registry["defaultTier"],
      version: registry["defaultVersion"],
      count: 0,
      registered: false,
    });
  };

  const addNode = (node: Node) => {
    if (!(node instanceof Element)) return;
    if (registry.add(node)) notify(capName(node)!);
    for (const child of node.querySelectorAll(`[${CAP_ATTR}]`)) {
      if (registry.add(child)) notify(capName(child)!);
    }
  };

  const removeNode = (node: Node) => {
    if (!(node instanceof Element)) return;
    const name = capName(node);
    if (name !== null && registry.remove(node, name)) notify(name);
    for (const child of node.querySelectorAll(`[${CAP_ATTR}]`)) {
      const childName = capName(child);
      if (childName !== null && registry.remove(child, childName)) {
        notify(childName);
      }
    }
  };

  const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      if (mutation.type === "attributes") {
        const el = mutation.target as Element;
        const oldName = mutation.oldValue ?? "";
        const newName = capName(el) ?? "";
        if (oldName !== "" && oldName !== newName) {
          if (registry.remove(el, oldName)) notify(oldName);
        }
        if (newName !== "" && newName !== oldName) {
          if (registry.add(el)) notify(newName);
        }
      } else if (mutation.type === "childList") {
        mutation.addedNodes.forEach(addNode);
        mutation.removedNodes.forEach(removeNode);
      }
    }
  });

  observer.observe(root, {
    subtree: true,
    childList: true,
    attributes: true,
    attributeFilter: [CAP_ATTR],
    attributeOldValue: true,
  });

  return () => observer.disconnect();
}
