import { describe, expect, it } from "vitest";
import { createEventBus } from "@platform/event-bus";
import {
  createSessionManager,
  DuplicateResourceError,
  SessionAlreadyActiveError,
  SessionArchivedError,
  SessionNotActiveError,
  SessionNotFoundError,
  type Clock,
  type ResourceRecord,
  type SessionStatus,
} from "../index.js";

class TestClock implements Clock {
  nowValue = 0;
  private nextHandle = 0;
  private readonly timers = new Map<number, { callback: () => void; due: number }>();

  now(): number {
    return this.nowValue;
  }

  setTimeout(callback: () => void, delayMs: number): number {
    const handle = this.nextHandle++;
    this.timers.set(handle, { callback, due: this.nowValue + delayMs });
    return handle;
  }

  clearTimeout(handle: number): void {
    this.timers.delete(handle);
  }

  advance(ms: number): void {
    const target = this.nowValue + ms;
    while (true) {
      const next = [...this.timers.entries()].filter(([, timer]) => timer.due <= target).sort((a, b) => a[1].due - b[1].due)[0];
      if (!next) break;
      this.nowValue = next[1].due;
      this.timers.delete(next[0]);
      next[1].callback();
    }
    this.nowValue = target;
  }
}

function resource(id = "resource-1"): ResourceRecord {
  return { id, type: "browser.tab", runtimeId: "browser-1", attachedAt: 0 };
}

describe("SessionManager", () => {
  it("creates active sessions with generated identity and timestamps", () => {
    const manager = createSessionManager(createEventBus());
    const session = manager.create({ ownerId: "app", adapterType: "mcp" });
    expect(session.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(session.status).toBe("active");
    expect(session.createdAt).toBe(session.lastActivityAt);
  });

  it("applies per-session timeout metadata", () => {
    const manager = createSessionManager(createEventBus());
    const session = manager.create({ ownerId: "app", adapterType: "cli", metadata: { idleTimeoutMs: "25", suspendedTtlMs: "50" } });
    expect(session.idleTimeoutMs).toBe(25);
    expect(session.suspendedTtlMs).toBe(50);
  });

  it("rejects empty owners and invalid adapters", () => {
    const manager = createSessionManager(createEventBus());
    expect(() => manager.create({ ownerId: " ", adapterType: "mcp" })).toThrow("ownerId");
    expect(() => manager.create({ ownerId: "app", adapterType: "bad" as "mcp" })).toThrow("adapterType");
  });

  it("enforces resume state errors", () => {
    const manager = createSessionManager(createEventBus());
    const session = manager.create({ ownerId: "app", adapterType: "rest" });
    expect(() => manager.resume(session.id)).toThrow(SessionAlreadyActiveError);
    expect(() => manager.resume("missing")).toThrow(SessionNotFoundError);
    manager.destroy(session.id);
    expect(() => manager.resume(session.id)).toThrow(SessionArchivedError);
  });

  it("destroys active sessions idempotently", () => {
    const manager = createSessionManager(createEventBus());
    const session = manager.create({ ownerId: "app", adapterType: "ws" });
    expect(manager.destroy(session.id).status).toBe("archived");
    expect(manager.destroy(session.id).status).toBe("archived");
  });

  it("suspends after idle timeout, resumes, and archives after suspended TTL", () => {
    const clock = new TestClock();
    const manager = createSessionManager(createEventBus(), { clock, archiveTtlMs: 100 });
    const session = manager.create({ ownerId: "app", adapterType: "mcp", metadata: { idleTimeoutMs: "10", suspendedTtlMs: "20" } });
    clock.advance(10);
    expect(manager.getStatus(session.id)).toBe("suspended");
    expect(manager.resume(session.id).status).toBe("active");
    clock.advance(10);
    expect(manager.getStatus(session.id)).toBe("suspended");
    clock.advance(20);
    expect(manager.getStatus(session.id)).toBe("archived");
    clock.advance(100);
    expect(() => manager.getStatus(session.id)).toThrow(SessionNotFoundError);
  });

  it("touch resets idle timeout and rejects inactive sessions", () => {
    const clock = new TestClock();
    const manager = createSessionManager(createEventBus(), { clock });
    const session = manager.create({ ownerId: "app", adapterType: "mcp", metadata: { idleTimeoutMs: "10" } });
    clock.advance(9);
    manager.touch(session.id);
    clock.advance(9);
    expect(manager.getStatus(session.id)).toBe("active");
    clock.advance(1);
    expect(manager.getStatus(session.id)).toBe("suspended");
    expect(() => manager.touch(session.id)).toThrow(SessionNotActiveError);
  });

  it("tracks resources and clears them after cleanup event", async () => {
    const bus = createEventBus();
    const manager = createSessionManager(bus);
    const events: string[] = [];
    bus.subscribe("session.*", (event) => {
      events.push(event.name);
      if (event.name === "session.cleanup_resources") expect(manager.listResources(session.id)).toEqual([]);
    });
    const session = manager.create({ ownerId: "app", adapterType: "mcp" });
    manager.attachResource(session.id, resource());
    expect(manager.listResources(session.id)).toEqual([resource()]);
    expect(() => manager.attachResource(session.id, resource())).toThrow(DuplicateResourceError);
    manager.detachResource(session.id, "resource-1");
    manager.attachResource(session.id, resource());
    manager.destroy(session.id);
    await Promise.resolve();
    expect(events).toEqual(["session.created", "session.cleanup_resources", "session.destroyed"]);
    expect(manager.listResources(session.id)).toEqual([]);
  });
  it("exports session status types", () => {
    const status: SessionStatus = "active";
    expect(status).toBe("active");
  });
});
