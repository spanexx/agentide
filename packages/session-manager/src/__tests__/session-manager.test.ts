import { describe, expect, it } from "vitest";
import { createEventBus } from "@platform/event-bus";
import {
  createSessionManager,
  SessionAlreadyActiveError,
  SessionArchivedError,
  SessionNotFoundError,
  type SessionStatus,
} from "../index.js";

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

  it("exports session status types", () => {
    const status: SessionStatus = "active";
    expect(status).toBe("active");
  });
});
