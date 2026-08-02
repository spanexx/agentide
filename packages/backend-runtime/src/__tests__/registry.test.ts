/*
 * Code Map: ConnectionRegistry tests
 * - accept: register a new connection; replace semantics if the connection
 *   key (appId, or appId:tabId per drift D-43) is reused
 * - get / remove / count / entries: lookup primitives
 * - replace behavior: old socket is closed; new socket wins
 * - D-43: two tabs of the same app (different tabId) coexist
 */

import { describe, it, expect } from "vitest";
import { ConnectionRegistry } from "../registry.js";
import type { Clock, WebSocketLike } from "../types.js";

class FakeClock implements Clock {
  nowValue = 1_700_000_000_000;
  now(): number { return this.nowValue; }
  setTimeout(): number { return 0; }
  clearTimeout(): void { /* noop */ }
}

function fakeSocket(): WebSocketLike & { isClosed(): boolean; getCloseCode(): number | undefined } {
  let closed = false;
  let closeCode: number | undefined;
  return {
    isClosed: () => closed,
    getCloseCode: () => closeCode,
    send: () => { /* noop for registry tests */ },
    close: (code?: number) => {
      closed = true;
      if (code !== undefined) closeCode = code;
    },
  };
}

describe("ConnectionRegistry", () => {
  const clock = new FakeClock();

  it("accept() returns null when no previous connection exists for the appId", () => {
    const reg = new ConnectionRegistry();
    const sock = fakeSocket();
    const replaced = reg.accept("customer-app", null, sock, clock);
    expect(replaced).toBeNull();
    expect(reg.count()).toBe(1);
    expect(reg.get("customer-app")?.socket).toBe(sock);
  });

  it("accept() returns the previous connection and closes it when an appId is reused", () => {
    const reg = new ConnectionRegistry();
    const oldSock = fakeSocket();
    const newSock = fakeSocket();
    reg.accept("customer-app", null, oldSock, clock);
    const replaced = reg.accept("customer-app", null, newSock, clock);
    expect(replaced?.socket).toBe(oldSock);
    expect(oldSock.isClosed()).toBe(true);
    expect(newSock.isClosed()).toBe(false);
    expect(reg.count()).toBe(1);
    expect(reg.get("customer-app")?.socket).toBe(newSock);
  });

  it("accept() keeps two tabs of the same app alive under appId:tabId keys (D-43)", () => {
    const reg = new ConnectionRegistry();
    const tab1 = fakeSocket();
    const tab2 = fakeSocket();
    reg.accept("shop-app", "tab-1", tab1, clock);
    reg.accept("shop-app", "tab-2", tab2, clock);
    expect(reg.count()).toBe(2);
    expect(reg.get("shop-app:tab-1")?.socket).toBe(tab1);
    expect(reg.get("shop-app:tab-2")?.socket).toBe(tab2);
    expect(tab1.isClosed()).toBe(false);
    // Same appId + same tabId still replaces (reconnect semantics preserved)
    const tab1b = fakeSocket();
    const replaced = reg.accept("shop-app", "tab-1", tab1b, clock);
    expect(replaced?.socket).toBe(tab1);
    expect(tab1.isClosed()).toBe(true);
    expect(reg.count()).toBe(2);
    expect(reg.get("shop-app:tab-1")?.socket).toBe(tab1b);
    // Connections carry the raw appId for event payloads
    expect([...reg.entries()].every(([, c]) => c.appId === "shop-app")).toBe(true);
    expect([...reg.entries()].map(([, c]) => c.tabId).sort()).toEqual(["tab-1", "tab-2"]);
  });

  it("accept() does not crash when closing the previous socket throws (defensive)", () => {
    const reg = new ConnectionRegistry();
    const oldSock: WebSocketLike = {
      send: () => { /* noop */ },
      close: () => {
        throw new Error("already closed");
      },
    };
    reg.accept("customer-app", null, oldSock, clock);
    expect(() => reg.accept("customer-app", null, fakeSocket(), clock)).not.toThrow();
  });

  it("get() returns undefined for unknown appId", () => {
    const reg = new ConnectionRegistry();
    expect(reg.get("nope")).toBeUndefined();
  });

  it("remove() returns the removed connection and decrements count (idempotent)", () => {
    const reg = new ConnectionRegistry();
    const sock = fakeSocket();
    reg.accept("customer-app", null, sock, clock);
    const removed = reg.remove("customer-app");
    expect(removed?.socket).toBe(sock);
    expect(reg.count()).toBe(0);
    expect(reg.get("customer-app")).toBeUndefined();
    expect(reg.remove("customer-app")).toBeUndefined();
  });

  it("clear() removes every connection and returns the prior entries", () => {
    const reg = new ConnectionRegistry();
    reg.accept("a", null, fakeSocket(), clock);
    reg.accept("b", null, fakeSocket(), clock);
    reg.accept("c", null, fakeSocket(), clock);
    const snapshot = reg.clear();
    expect(snapshot).toHaveLength(3);
    expect(reg.count()).toBe(0);
  });

  it("entries() iterates live connection-key→connection pairs", () => {
    const reg = new ConnectionRegistry();
    reg.accept("a", null, fakeSocket(), clock);
    reg.accept("b", null, fakeSocket(), clock);
    const ids = [...reg.entries()].map(([appId]) => appId).sort();
    expect(ids).toEqual(["a", "b"]);
  });
});