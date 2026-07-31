import { describe, expect, it } from "vitest";
import { RateLimiter } from "../rate-limit.js";
import type { Clock, RateLimitBucketConfig } from "../index.js";

class FakeClock implements Clock {
  nowValue = 1_700_000_000_000;
  now(): number { return this.nowValue; }
  setTimeout(cb: () => void, _ms: number): number { cb(); return 0; }
  clearTimeout(_h: number): void { /* noop */ }
  advance(ms: number): void { this.nowValue += ms; }
}

const defaultConfig: RateLimitBucketConfig = { capacity: 100, tokensPerSecond: 10 };

describe("RateLimiter (per-key token bucket)", () => {
  it("first call consumes 1 token; starts at capacity", () => {
    const clock = new FakeClock();
    const rl = new RateLimiter(defaultConfig, clock);
    expect(rl.tryConsume("alice")).toBe(true);
    expect(rl.peek("alice")).toBe(99);
  });

  it("rejects after capacity tokens consumed", () => {
    const clock = new FakeClock();
    const rl = new RateLimiter(defaultConfig, clock);
    for (let i = 0; i < 100; i++) {
      expect(rl.tryConsume("alice")).toBe(true);
    }
    expect(rl.tryConsume("alice")).toBe(false);
    expect(rl.peek("alice")).toBe(0);
  });

  it("refills tokensPerSecond over elapsed time (frozen-clock deterministic)", () => {
    const clock = new FakeClock();
    const rl = new RateLimiter(defaultConfig, clock);
    for (let i = 0; i < 100; i++) rl.tryConsume("alice");
    expect(rl.tryConsume("alice")).toBe(false);
    clock.advance(1000);
    for (let i = 0; i < 10; i++) {
      expect(rl.tryConsume("alice")).toBe(true);
    }
    expect(rl.tryConsume("alice")).toBe(false);
  });

  it("refills exactly one token when 100 ms (one per-token interval) elapses", () => {
    const clock = new FakeClock();
    const rl = new RateLimiter(defaultConfig, clock);
    for (let i = 0; i < 100; i++) rl.tryConsume("alice");
    expect(rl.tryConsume("alice")).toBe(false);
    clock.advance(100);
    expect(rl.tryConsume("alice")).toBe(true);
  });

  it("caps refill at capacity (no overflow past max)", () => {
    const clock = new FakeClock();
    const rl = new RateLimiter(defaultConfig, clock);
    for (let i = 0; i < 50; i++) rl.tryConsume("alice");
    expect(rl.peek("alice")).toBe(50);
    clock.advance(1_000_000);
    expect(rl.peek("alice")).toBe(100);
  });

  it("different keys have independent buckets", () => {
    const clock = new FakeClock();
    const rl = new RateLimiter(defaultConfig, clock);
    for (let i = 0; i < 100; i++) rl.tryConsume("alice");
    expect(rl.tryConsume("alice")).toBe(false);
    expect(rl.tryConsume("bob")).toBe(true);
    expect(rl.peek("bob")).toBe(99);
  });

  it("peek returns capacity for an unseen key without consuming", () => {
    const clock = new FakeClock();
    const rl = new RateLimiter(defaultConfig, clock);
    expect(rl.peek("carol")).toBe(100);
    expect(rl.tryConsume("carol")).toBe(true);
    expect(rl.peek("carol")).toBe(99);
  });

  it("evicts buckets idle longer than the configured ttl", () => {
    const clock = new FakeClock();
    const rl = new RateLimiter({ ...defaultConfig, idleTtlMs: 1000 }, clock);
    rl.tryConsume("alice");
    rl.tryConsume("bob");
    expect(rl.bucketCount()).toBe(2);
    clock.advance(1001);
    rl.sweep();
    expect(rl.bucketCount()).toBe(0);
  });

  it("sweep keeps buckets that were touched within the ttl", () => {
    const clock = new FakeClock();
    const rl = new RateLimiter({ ...defaultConfig, idleTtlMs: 1000 }, clock);
    rl.tryConsume("alice");
    clock.advance(500);
    rl.tryConsume("bob");
    clock.advance(600);
    rl.sweep();
    expect(rl.bucketCount()).toBe(1);
  });

  it("retries under the per-token interval accumulate progress (no starvation)", () => {
    const clock = new FakeClock();
    const rl = new RateLimiter(defaultConfig, clock);
    let earned = false;
    for (let i = 0; i < 200; i++) {
      if (rl.tryConsume("alice")) {
        earned = true;
        break;
      }
      clock.advance(99);
    }
    expect(earned).toBe(true);
  });
});
