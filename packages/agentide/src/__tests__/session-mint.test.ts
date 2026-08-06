// Phase 4: withAutoSession (Q1)
// Behavior: mint a session, run the wrapped fn, destroy the session.
import { describe, expect, it, vi } from "vitest";
import type { YamlValue } from "@spanexx/gateway-core";
import { withAutoSession } from "../session-mint.js";

type InvokeHandler = (name: string, opts: { input?: YamlValue; sessionId?: string } | undefined) => Promise<YamlValue>;

function mkClient(handler: InvokeHandler) {
  return { invoke: vi.fn(handler) };
}

const YamlObject = (o: Record<string, unknown>): YamlValue => o as YamlValue;

describe("withAutoSession", () => {
  it("mints a session, runs fn, destroys the session", async () => {
    const calls: string[] = [];
    const client = mkClient(async (name, opts) => {
      calls.push(`${name}:${opts?.sessionId ?? "-"}`);
      if (name === "session.create") return YamlObject({ id: "sess-1" });
      return YamlObject({ ok: true });
    });
    // session.create is now called with {ownerId, adapterType}. The mock
    // above returns {id:"sess-1"} regardless of input.
    const result = await withAutoSession(client, async (sid) => {
      expect(sid).toBe("sess-1");
      return await client.invoke("product.list", { sessionId: sid });
    });
    expect(result).toEqual({ ok: true });
    // The mock records `${name}:${sessionId}` where sessionId is the
    // session arg (or "-" for session.create, which is invoked without
    // a sessionId). withAutoSession passes {ownerId, adapterType} to
    // session.create and session.destroy takes the minted id.
    expect(calls).toEqual([
      "session.create:-",
      "product.list:sess-1",
      "session.destroy:sess-1",  // session.destroy runs IN the auto-minted session
    ]);
  });

  it("passes ownerId + adapterType to session.create", async () => {
    const seenInputs: unknown[] = [];
    const client = mkClient(async (_name, opts) => {
      seenInputs.push(opts?.input);
      return YamlObject({ id: "sess-x" });
    });
    await withAutoSession(client, async () => "ok");
    expect(seenInputs[0]).toEqual({ ownerId: "agentide-cli", adapterType: "cli" });
  });

  it("still destroys the session when fn throws", async () => {
    const calls: string[] = [];
    const client = mkClient(async (name, opts) => {
      calls.push(`${name}:${opts?.sessionId ?? "-"}`);
      if (name === "session.create") return YamlObject({ id: "sess-2" });
      if (name === "product.list") throw new Error("boom");
      return YamlObject({});
    });
    await expect(withAutoSession(client, async (sid) => {
      await client.invoke("product.list", { sessionId: sid });
    })).rejects.toThrow("boom");
    expect(calls).toEqual([
      "session.create:-",
      "product.list:sess-2",
      "session.destroy:sess-2",
    ]);
  });

  it("appends a warning when session.destroy fails", async () => {
    const client = mkClient(async (name) => {
      if (name === "session.create") return YamlObject({ id: "sess-3" });
      if (name === "session.destroy") throw new Error("destroy failed");
      return YamlObject({});
    });
    const warnings: string[] = [];
    await withAutoSession(client, async () => "ok" as unknown as YamlValue, { warnings });
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("session.destroy failed");
  });

  it("throws when session.create returns no id", async () => {
    const client = mkClient(async () => YamlObject({ not: "an id" }));
    await expect(withAutoSession(client, async () => "ok" as unknown as YamlValue)).rejects.toThrow(/no session id/);
  });
});
