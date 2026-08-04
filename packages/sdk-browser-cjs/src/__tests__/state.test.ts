/** @vitest-environment jsdom */
/**
 * Phase 5 — state surface (GRILL T4 D3).
 *
 * `onStateChange` fires ONLY on real transitions between the four states;
 * `state()` is a synchronous snapshot that also mirrors the capability
 * inventory with the connection-aware `registered` flag.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CapRegistry } from "../observer";
import { StateStore } from "../state";
import type { ConnectionState } from "../types";

let registry: CapRegistry;
let store: StateStore;

beforeEach(() => {
  registry = new CapRegistry("act", "1.0.0");
  store = new StateStore(registry);
});

afterEach(() => {
  document.body.innerHTML = "";
});

describe("onStateChange (real transitions only)", () => {
  it("fires only on actual state changes, not repeats", () => {
    const seen: ConnectionState[] = [];
    store.onStateChange((s) => seen.push(s));

    store.setConnection("connecting");
    store.setConnection("connecting"); // repeat — not a transition
    store.setConnection("connected");
    store.setConnection("connected"); // repeat
    store.setConnection("disconnected");
    expect(seen).toEqual(["connecting", "connected", "disconnected"]);
  });

  it("unsubscribe stops delivery", () => {
    const seen: ConnectionState[] = [];
    const unsubscribe = store.onStateChange((s) => seen.push(s));
    store.setConnection("connecting");
    unsubscribe();
    store.setConnection("connected");
    expect(seen).toEqual(["connecting"]);
  });

  it("multiple subscribers each receive transitions", () => {
    const a: ConnectionState[] = [];
    const b: ConnectionState[] = [];
    store.onStateChange((s) => a.push(s));
    store.onStateChange((s) => b.push(s));
    store.setConnection("connected");
    expect(a).toEqual(["connected"]);
    expect(b).toEqual(["connected"]);
  });
});

describe("state() snapshot", () => {
  it("reflects the current connection state", () => {
    expect(store.state().connectionState).toBe("disconnected");
    store.setConnection("reconnecting");
    expect(store.state().connectionState).toBe("reconnecting");
  });

  it("mirrors the registry with the registered flag", () => {
    const el = document.createElement("button");
    el.setAttribute("data-sdk-cap", "shop.checkout");
    document.body.appendChild(el);
    registry.add(el);

    let state = store.state();
    expect(state.capabilities).toHaveLength(1);
    expect(state.capabilities[0]).toMatchObject({
      name: "shop.checkout",
      count: 1,
      registered: false,
    });

    registry.setRegistered("shop.checkout", true);
    state = store.state();
    expect(state.capabilities[0].registered).toBe(true);
  });
});
