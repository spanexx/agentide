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
// Used in tests by: 9 cases above covering capacity exhaustion, refill rate, fractional accumulation, capacity cap, key isolation, peek, idle eviction
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

  bucketCount(): number {
    return this.buckets.size;
  }

  sweep(): number {
    const idleTtlMs = this.config.idleTtlMs ?? 3_600_000;
    const cutoff = this.clock.now() - idleTtlMs;
    let removed = 0;
    for (const [key, bucket] of this.buckets) {
      if (bucket.lastRefillAt < cutoff) {
        this.buckets.delete(key);
        removed += 1;
      }
    }
    return removed;
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
        // Round DOWN — a caller retrying every millisecond must NOT earn a token
        // for fractional accumulation. (Math.ceil would let a 1ms retry earn 1 token
        // per retry at 10 tokens/sec config — 10x the configured rate.)
        const refilled = Math.floor((elapsedMs * this.config.tokensPerSecond) / 1000);
        if (refilled > 0) {
          bucket.tokens = Math.min(this.config.capacity, bucket.tokens + refilled);
          // Advance lastRefillAt by the milliseconds that produced the refilled
          // tokens, not to `now`. Without this, sub-interval callers lose the
          // fractional progress every call → permanent starvation when retrying
          // faster than one-token-per-interval.
          bucket.lastRefillAt += Math.floor((refilled * 1000) / this.config.tokensPerSecond);
        }
      }
    }
    return bucket;
  }
}