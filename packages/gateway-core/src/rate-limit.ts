/*
 * Code Map: per-key token-bucket rate limiter
 * - RateLimiter: in-memory Map of (key → bucket); lazy refill on each access; deterministic with frozen clock
 *
 * CID Index:
 * CID:rate-001 -> RateLimiter
 *
 * Quick lookup: rg -n "CID:rate-" packages/gateway-core/src/rate-limit.ts
 */

import type { Clock, RateLimitBucketConfig } from "./types.js";

interface Bucket {
  tokens: number;
  lastRefillAt: number;
}

// CID:rate-001 - RateLimiter
// Purpose: per-(tenantId, callerId) token bucket; lazy refill on each access; deterministic with injected Clock
// Used by: handleInvocation pipeline (every invocation consumes 1 token)
// Used in tests by: 7 cases above covering capacity exhaustion, refill rate, fractional accumulation, capacity cap, key isolation, peek
export class RateLimiter {
  private readonly buckets = new Map<string, Bucket>();

  constructor(
    private readonly config: RateLimitBucketConfig,
    private readonly clock: Clock,
  ) {}

  tryConsume(key: string): boolean {
    const bucket = this.getBucket(key);
    if (bucket.tokens < 1) return false;
    bucket.tokens -= 1;
    return true;
  }

  peek(key: string): number {
    return this.getBucket(key).tokens;
  }

  private getBucket(key: string): Bucket {
    const now = this.clock.now();
    let bucket = this.buckets.get(key);
    if (bucket === undefined) {
      bucket = { tokens: this.config.capacity, lastRefillAt: now };
      this.buckets.set(key, bucket);
    } else {
      const elapsedMs = now - bucket.lastRefillAt;
      if (elapsedMs > 0) {
        const refilled = Math.ceil((elapsedMs * this.config.tokensPerSecond) / 1000);
        bucket.tokens = Math.min(this.config.capacity, bucket.tokens + refilled);
        bucket.lastRefillAt = now;
      }
    }
    return bucket;
  }
}