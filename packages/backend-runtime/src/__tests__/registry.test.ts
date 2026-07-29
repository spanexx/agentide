/*
 * Code Map: ConnectionRegistry tests
 * - accept: register a new connection; replace semantics if appId exists
 * - get / remove / count / entries: lookup primitives
 * - replace behavior: old socket is closed; new socket wins
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
    const replaced = reg.accept("customer-app", sock, clock);
    expect(replaced).toBeNull();
    expect(reg.count()).toBe(1);
    expect(reg.get("customer-app")?.socket).toBe(sock);
  });

  it("accept() returns the previous connection and closes it when an appId is reused", () => {
    const reg = new ConnectionRegistry();
    const oldSock = fakeSocket();
    const newSock = fakeSocket();
    reg.accept("customer-app", oldSock, clock);
    const replaced = reg.accept("customer-app", newSock, clock);
    expect(replaced?.socket).toBe(oldSock);
    expect(oldSock.isClosed()).toBe(true);
    expect(newSock.isClosed()).toBe(false);
    expect(reg.count()).toBe(1);
    expect(reg.get("customer-app")?.socket).toBe(newSock);
  });

  it("accept() does not crash when closing the previous socket throws (defensive)", () => {
    const reg = new ConnectionRegistry();
    const oldSock: WebSocketLike = {
      close: () => {
        throw new Error("already closed");
      },
    };
    reg.accept("customer-app", oldSock, clock);
    expect(() => reg.accept("customer-app", fakeSocket(), clock)).not.toThrow();
  });

  it("get() returns undefined for unknown appId", () => {
    const reg = new ConnectionRegistry();
    expect(reg.get("nope")).toBeUndefined();
  });

  it("remove() returns the removed connection and decrements count (idempotent)", () => {
    const reg = new ConnectionRegistry();
    const sock = fakeSocket();
    reg.accept("customer-app", sock, clock);
    const removed = reg.remove("customer-app");
    expect(removed?.socket).toBe(sock);
    expect(reg.count()).toBe(0);
    expect(reg.get("customer-app")).toBeUndefined();
    expect(reg.remove("customer-app")).toBeUndefined();
  });

  it("clear() removes every connection and returns the prior entries", () => {
    const reg = new ConnectionRegistry();
    reg.accept("a", fakeSocket(), clock);
    reg.accept("b", fakeSocket(), clock);
    reg.accept("c", fakeSocket(), clock);
    const snapshot = reg.clear();
    expect(snapshot).toHaveLength(3);
    expect(reg.count()).toBe(0);
  });

  it("entries() iterates live appId→connection pairs", () => {
    const reg = new ConnectionRegistry();
    reg.accept("a", fakeSocket(), clock);
    reg.accept("b", fakeSocket(), clock);
    const ids = [...reg.entries()].map(([appId]) => appId).sort();
    expect(ids).toEqual(["a", "b"]);
  });
});