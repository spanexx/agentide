/*
 * Code Map: InvocationDispatcher tests (Phase 4)
 * - success path: SDK echoes sdk.invoke.result; payload returns
 * - handler throws: SDK sends sdk.invoke.error HANDLER_ERROR -> GatewayError
 * - handler not found: HANDLER_NOT_FOUND -> GATEWAY_CAPABILITY_NOT_FOUND
 * - handler times out: handlerTimeoutMs elapses -> GATEWAY_HANDLER_TIMEOUT
 * - socket closed mid-invoke: connection gone -> GATEWAY_SDK_UNREACHABLE
 * - socket send throws: -> GATEWAY_SDK_UNREACHABLE
 * - no connection for owner: -> GATEWAY_SDK_UNREACHABLE
 * - non-backend-sdk owner: -> GATEWAY_CAPABILITY_NOT_FOUND (defensive)
 */

import { describe, it, expect } from "vitest";
import { InvocationDispatcher } from "../dispatch.js";
import { ConnectionRegistry } from "../registry.js";
import type { Clock } from "../types.js";

class FakeClock implements Clock {
  nowValue = 1_700_000_000_000;
  private nextId = 0;
  private timers = new Map<number, { fireAt: number; cb: () => void }>();

  now(): number { return this.nowValue; }
  setTimeout(cb: () => void, delayMs: number): number {
    const id = ++this.nextId;
    this.timers.set(id, { fireAt: this.nowValue + delayMs, cb });
    return id;
  }
  clearTimeout(id: number): void {
    this.timers.delete(id);
  }
  /** Advance the clock by `ms` and fire any timers whose deadline has passed. */
  advance(ms: number): void {
    this.nowValue += ms;
    const ready: Array<() => void> = [];
    for (const [id, t] of this.timers) {
      if (t.fireAt <= this.nowValue) {
        this.timers.delete(id);
        ready.push(t.cb);
      }
    }
    for (const cb of ready) cb();
  }
}

interface FakeSocket {
  sent: string[];
  closed: boolean;
  send(data: string): void;
  close(): void;
  /** Optional override for testing — invokes send()'s throw path. */
  throwOnNextSend?: Error;
}

function fakeSocket(): FakeSocket {
  const sock: FakeSocket = {
    sent: [],
    closed: false,
    send(data: string): void {
      if (sock.throwOnNextSend) {
        const err = sock.throwOnNextSend;
        sock.throwOnNextSend = undefined;
        throw err;
      }
      sock.sent.push(data);
    },
    close(): void {
      sock.closed = true;
    },
  };
  return sock;
}

function setup(handlerTimeoutMs = 30_000) {
  const clock = new FakeClock();
  const registry = new ConnectionRegistry();
  const dispatcher = new InvocationDispatcher(registry, handlerTimeoutMs, clock);
  return { clock, registry, dispatcher };
}

describe("InvocationDispatcher", () => {
  it("success: SDK echoes sdk.invoke.result, payload is returned", async () => {
    const { clock, registry, dispatcher } = setup();
    const sock = fakeSocket();
    registry.accept("app", null, sock as never, clock);

    const promise = dispatcher.dispatchInvocation(
      "backend-sdk-app",
      "customer.read",
      { id: "c-042" },
      undefined,
    );

    // Verify the wire message was sent before the SDK responds
    expect(sock.sent).toHaveLength(1);
    const sent = JSON.parse(sock.sent[0]!);
    expect(sent).toMatchObject({
      type: "sdk.invoke",
      name: "customer.read",
      input: { id: "c-042" },
    });
    expect(sent.callId).toMatch(/^call-\d+$/);

    // SDK responds with the result
    const callId = sent.callId;
    const ok = dispatcher.handleResult(callId, { id: "c-042", name: "Customer 042" });
    expect(ok).toBe(true);

    await expect(promise).resolves.toEqual({ id: "c-042", name: "Customer 042" });
  });

  it("HANDLER_ERROR maps to GATEWAY_INTERNAL_ERROR", async () => {
    const { clock, registry, dispatcher } = setup();
    const sock = fakeSocket();
    registry.accept("app", null, sock as never, clock);

    const promise = dispatcher.dispatchInvocation(
      "backend-sdk-app",
      "customer.read",
      { id: "boom" },
      undefined,
    );

    const callId = JSON.parse(sock.sent[0]!).callId;
    dispatcher.handleError(callId, "HANDLER_ERROR", "kaboom");

    await expect(promise).rejects.toMatchObject({
      code: "GATEWAY_INTERNAL_ERROR",
      message: expect.stringContaining("kaboom") as string,
      retryable: false,
    });
  });

  it("HANDLER_NOT_FOUND maps to GATEWAY_CAPABILITY_NOT_FOUND", async () => {
    const { clock, registry, dispatcher } = setup();
    const sock = fakeSocket();
    registry.accept("app", null, sock as never, clock);

    const promise = dispatcher.dispatchInvocation(
      "backend-sdk-app",
      "ghost.cap",
      {},
      undefined,
    );

    const callId = JSON.parse(sock.sent[0]!).callId;
    dispatcher.handleError(callId, "HANDLER_NOT_FOUND", "no handler");

    await expect(promise).rejects.toMatchObject({
      code: "GATEWAY_CAPABILITY_NOT_FOUND",
      retryable: false,
    });
  });

  it("unknown SDK error code maps to GATEWAY_INTERNAL_ERROR", async () => {
    const { clock, registry, dispatcher } = setup();
    const sock = fakeSocket();
    registry.accept("app", null, sock as never, clock);

    const promise = dispatcher.dispatchInvocation(
      "backend-sdk-app",
      "x",
      {},
      undefined,
    );

    const callId = JSON.parse(sock.sent[0]!).callId;
    dispatcher.handleError(callId, "WEIRD_CODE", "wat");

    await expect(promise).rejects.toMatchObject({
      code: "GATEWAY_INTERNAL_ERROR",
      message: expect.stringContaining("WEIRD_CODE") as string,
    });
  });

  it("handler times out -> GATEWAY_HANDLER_TIMEOUT", async () => {
    const { clock, registry, dispatcher } = setup(5_000);
    const sock = fakeSocket();
    registry.accept("app", null, sock as never, clock);

    const promise = dispatcher.dispatchInvocation(
      "backend-sdk-app",
      "slow.cap",
      {},
      undefined,
    );

    // The SDK never responds. Advance the clock past the timeout to fire the
    // FakeClock-scheduled reject callback synchronously.
    clock.advance(5_001);

    await expect(promise).rejects.toMatchObject({
      code: "GATEWAY_HANDLER_TIMEOUT",
      retryable: true,
    });
  });

  it("socket send throws -> GATEWAY_SDK_UNREACHABLE", async () => {
    const { clock, registry, dispatcher } = setup();
    const sock = fakeSocket();
    sock.throwOnNextSend = new Error("socket died");
    registry.accept("app", null, sock as never, clock);

    const promise = dispatcher.dispatchInvocation(
      "backend-sdk-app",
      "x",
      {},
      undefined,
    );

    await expect(promise).rejects.toMatchObject({
      code: "GATEWAY_SDK_UNREACHABLE",
      retryable: true,
    });
  });

  it("no connection for owner -> GATEWAY_SDK_UNREACHABLE", async () => {
    const { dispatcher } = setup();

    await expect(
      dispatcher.dispatchInvocation("backend-sdk-ghost", "x", {}, undefined),
    ).rejects.toMatchObject({
      code: "GATEWAY_SDK_UNREACHABLE",
      retryable: true,
    });
  });

  it("non-backend-sdk owner -> GATEWAY_CAPABILITY_NOT_FOUND (defensive)", async () => {
    const { dispatcher } = setup();

    await expect(
      dispatcher.dispatchInvocation("platform-x", "y", {}, undefined),
    ).rejects.toMatchObject({
      code: "GATEWAY_CAPABILITY_NOT_FOUND",
      retryable: false,
    });
  });

  it("handleResult/handleError return false for unknown callId (defensive)", () => {
    const { dispatcher } = setup();
    expect(dispatcher.handleResult("nope", { ok: true })).toBe(false);
    expect(dispatcher.handleError("nope", "X", "msg")).toBe(false);
  });

  it("rejectAllPending rejects every pending callId for the appId with SDK_UNREACHABLE", async () => {
    const { clock, registry, dispatcher } = setup();
    const sock = fakeSocket();
    registry.accept("app", null, sock as never, clock);

    const p1 = dispatcher.dispatchInvocation("backend-sdk-app", "a", {}, undefined);
    const p2 = dispatcher.dispatchInvocation("backend-sdk-app", "b", {}, undefined);
    const p3 = dispatcher.dispatchInvocation("backend-sdk-app", "c", {}, undefined);
    // SDK didn't respond; peer dropped instead
    dispatcher.rejectAllPending("app", "connection closed");

    await expect(p1).rejects.toMatchObject({ code: "GATEWAY_SDK_UNREACHABLE", retryable: true });
    await expect(p2).rejects.toMatchObject({ code: "GATEWAY_SDK_UNREACHABLE", retryable: true });
    await expect(p3).rejects.toMatchObject({ code: "GATEWAY_SDK_UNREACHABLE", retryable: true });
  });

  it("resolveAllPending only affects the matching appId, not other apps", async () => {
    const { clock, registry, dispatcher } = setup();
    const sockA = fakeSocket();
    const sockB = fakeSocket();
    registry.accept("appA", null, sockA as never, clock);
    registry.accept("appB", null, sockB as never, clock);

    const pA = dispatcher.dispatchInvocation("backend-sdk-appA", "x", {}, undefined);
    const pB = dispatcher.dispatchInvocation("backend-sdk-appB", "y", {}, undefined);
    dispatcher.rejectAllPending("appA", "appA closed");
    // appB's invocation still pending
    await expect(pA).rejects.toMatchObject({ code: "GATEWAY_SDK_UNREACHABLE" });
    // Resolve appB's manually
    const callIdB = JSON.parse(sockB.sent[0]!).callId;
    dispatcher.handleResult(callIdB, { ok: true });
    await expect(pB).resolves.toEqual({ ok: true });
  });
});