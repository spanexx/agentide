import { describe, expect, it } from "vitest";
import type { CanonicalInvocation, CanonicalResponse, Gateway, YamlValue } from "@spanexx/gateway-core";
import { createAdapterPipeline, type PipelineInvocation } from "../pipeline.js";
import { createErrorConverter, type DoorError } from "../error-converter.js";
import type { ResponseChannelSink } from "../response-channel.js";

interface Rendered {
  readonly kind: "chunk" | "event" | "result" | "error";
  readonly payload: YamlValue | DoorError | undefined;
}

function renderer(): { sink: (cid: string) => ResponseChannelSink; frames: Rendered[]; callIds: string[] } {
  const frames: Rendered[] = [];
  const callIds: string[] = [];
  const sink = (cid: string): ResponseChannelSink => {
    callIds.push(cid);
    return {
      emitChunk: (chunk) => frames.push({ kind: "chunk", payload: chunk }),
      emitEvent: (topic, payload) => frames.push({ kind: "event", payload: { topic, payload } }),
      emitResult: (output) => frames.push({ kind: "result", payload: output }),
      emitError: (error) => frames.push({ kind: "error", payload: error }),
    };
  };
  return { sink, frames, callIds };
}

function gateway(response: CanonicalResponse, seen?: CanonicalInvocation[]): Gateway {
  return {
    handleInvocation: async (request) => {
      seen?.push(request);
      return response;
    },
  } as Gateway;
}

const identityConverter = createErrorConverter({
  defaultError: (p) => ({ code: p.code, message: p.message, details: p.details }),
});

function invokeArgs(overrides: Partial<PipelineInvocation> = {}): PipelineInvocation {
  return {
    correlationId: "c1",
    token: "verified-token",
    name: "capability.list",
    ...overrides,
  };
}

describe("createAdapterPipeline", () => {
  it("routes a call-mode success to end(output)", async () => {
    const { sink, frames } = renderer();
    const pipeline = createAdapterPipeline({ gateway: gateway({ output: { ok: true } }), errors: identityConverter, response: sink });
    await pipeline.invoke(invokeArgs());
    expect(frames).toEqual([{ kind: "result", payload: { ok: true } }]);
  });

  it("routes a stream-mode success to emit + end", async () => {
    const { sink, frames } = renderer();
    const pipeline = createAdapterPipeline({ gateway: gateway({ output: { ok: true } }), errors: identityConverter, response: sink });
    await pipeline.invoke(invokeArgs({ mode: "stream" }));
    expect(frames).toEqual([
      { kind: "chunk", payload: { ok: true } },
      { kind: "result", payload: { ok: true } },
    ]);
  });

  it("routes an error response through the converter", async () => {
    const { sink, frames } = renderer();
    const pipeline = createAdapterPipeline({
      gateway: gateway({ error: { code: "SESSION_NOT_FOUND", message: "missing", details: { id: "s1" }, retryable: false } }),
      errors: identityConverter,
      response: sink,
    });
    await pipeline.invoke(invokeArgs());
    expect(frames).toEqual([
      { kind: "error", payload: { code: "SESSION_NOT_FOUND", message: "missing", details: { id: "s1" } } },
    ]);
  });

  it("translates unmapped codes via the shared default fallback (-32006)", async () => {
    const { sink, frames } = renderer();
    const pipeline = createAdapterPipeline({
      gateway: gateway({ error: { code: "SOME_NEW_CODE", message: "x", details: {}, retryable: false } }),
      errors: createErrorConverter(),
      response: sink,
    });
    await pipeline.invoke(invokeArgs());
    expect(frames).toEqual([{ kind: "error", payload: { code: -32006, message: "SOME_NEW_CODE: x" } }]);
  });

  it("builds the canonical invocation with token, capability, defaulted input", async () => {
    const seen: CanonicalInvocation[] = [];
    const { sink } = renderer();
    const pipeline = createAdapterPipeline({ gateway: gateway({ output: [] }, seen), errors: identityConverter, response: sink });
    await pipeline.invoke(invokeArgs({ name: "session.list", input: { filter: "active" }, sessionId: "s1" }));
    expect(seen[0]).toMatchObject({
      token: "verified-token",
      capability: { name: "session.list" },
      input: { filter: "active" },
      sessionId: "s1",
    });
  });

  it("preserves explicit null input", async () => {
    const seen: CanonicalInvocation[] = [];
    const { sink } = renderer();
    const pipeline = createAdapterPipeline({ gateway: gateway({ output: { ok: true } }, seen), errors: identityConverter, response: sink });
    await pipeline.invoke(invokeArgs({ input: null }));
    expect(seen[0]?.input).toBeNull();
  });

  it("creates one channel per correlation id", async () => {
    const { sink, callIds } = renderer();
    const pipeline = createAdapterPipeline({ gateway: gateway({ output: {} }), errors: identityConverter, response: sink });
    await pipeline.invoke(invokeArgs({ correlationId: "a" }));
    await pipeline.invoke(invokeArgs({ correlationId: "b" }));
    expect(callIds).toEqual(["a", "b"]);
  });
});
