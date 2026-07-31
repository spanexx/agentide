# Agentide Production Readiness & Issues Report

This report outlines critical architectural and implementation issues identified during a comprehensive code audit of the Agentide codebase. These issues range from memory leaks that could cause container crashes (Out-Of-Memory / OOM), logical bugs in rate-limiting mathematics leading to permanent client starvation, file-system race conditions under high concurrency, to missing safety boundaries.

Each finding is detailed below with **Impact**, **Root Cause**, **Code Locations**, and a **Proposed Fix / Recommendation**.

---

## 1. Memory Leak in Session Manager (Stale `timers` Entry Accumulation)

### Impact: **High / Operational Risk (Slow OOM Crash)**
Over time, the Gateway process will consume unbounded memory and eventually crash due to Node's heap memory exhaustion (OOM), especially in environments with high session churn (frequent creation and destruction of short-lived sessions).

### Root Cause
In `packages/session-manager/src/index.ts`, when a session is created, timer handles (such as idle timeout, suspended TTL, or archive timers) are stored in the `timers` Map:
```typescript
const timers = new Map<string, { idle?: number; suspended?: number; archive?: number }>();
```
When a session is explicitly or implicitly destroyed, the `destroy` function schedules a timeout to remove the session from the active/archived state map after `archiveTtlMs` has passed:
```typescript
function destroy(sessionId: string, reason: DestroyReason = "explicit"): SessionRecord {
  const current = get(sessionId);
  if (current.status === "archived") return current;
  cancel(sessionId);
  const destroyed = save({ ...current, status: "archived", destroyedAt: clock.now() });
  events.cleanupResources(sessionId);
  resources.clear(sessionId);
  events.destroyed(destroyed, reason);
  const archive = clock.setTimeout(() => sessions.delete(sessionId), config.archiveTtlMs ?? DEFAULT_ARCHIVE_TTL_MS);
  timers.set(sessionId, { archive }); // <-- TIMER RECORD IS STORED
  return destroyed;
}
```
When the scheduled timeout fires, the callback executes `sessions.delete(sessionId)`. However, **it never deletes the corresponding entry from the `timers` Map**.
As a result, every session ever created leaves a permanent key-value pair (`sessionId -> { archive }`) inside the `timers` Map even after its data has been purged from the `sessions` Map.

### Code Location
- `packages/session-manager/src/index.ts:140-153`

### Actionable Recommendation
Update the timeout callback inside `destroy` to delete the entry from the `timers` map as well:
```typescript
<<<<<<< SEARCH
  const archive = clock.setTimeout(() => sessions.delete(sessionId), config.archiveTtlMs ?? DEFAULT_ARCHIVE_TTL_MS);
  timers.set(sessionId, { archive });
=======
  const archive = clock.setTimeout(() => {
    sessions.delete(sessionId);
    timers.delete(sessionId);
  }, config.archiveTtlMs ?? DEFAULT_ARCHIVE_TTL_MS);
  timers.set(sessionId, { archive });
>>>>>>> REPLACE
```

---

## 2. Unbounded Rate-Limiter Map Growth (Memory Leak on Transient Callers)

### Impact: **High / Operational Risk (Denial of Service via OOM)**
A malicious attacker or massive scale of transient/one-time users can deplete the Gateway's memory by sending requests using random/unique `callerId`s.

### Root Cause
The `RateLimiter` class implements rate limits per client by storing buckets in-memory:
```typescript
private readonly buckets = new Map<string, Bucket>();
```
The bucket keys are formed by concatenating the tenant ID and caller ID (`${tenantId}:${callerId}`).
Whenever a request is dispatched, `tryConsume` is called, lazy-initializing a bucket for that caller if it doesn't already exist. However, **there is absolutely no eviction policy, expiration mechanism, or size limit on the `buckets` Map**. Stale buckets are kept in memory indefinitely, creating a severe memory leak in production.

### Code Location
- `packages/gateway-core/src/rate-limit.ts:16-52`

### Actionable Recommendation
Introduce a Garbage Collection (GC) helper or utilize an LRU cache (such as `lru-cache`) to automatically discard buckets that have not been accessed or refilled for a long period (e.g., older than 1 hour). Alternatively, implement a sweeping routine:
```typescript
// Example periodic sweep
setInterval(() => {
  const now = Date.now();
  for (const [key, bucket] of this.buckets.entries()) {
    if (now - bucket.lastRefillAt > 3600000) { // 1 hour inactive
      this.buckets.delete(key);
    }
  }
}, 600000); // Sweep every 10 minutes
```

---

## 3. Persistent Client Starvation via Integer Rate-Limiting Truncation

### Impact: **Critical / Functional Bug (Legitimate Clients Starved & Blocked)**
Legitimate clients or high-frequency polling SDK components can be permanently rate-limited and starved of tokens, even if their average request rate is well below the configured limits.

### Root Cause
In `packages/gateway-core/src/rate-limit.ts` inside `getBucket(key)`:
```typescript
const elapsedMs = now - bucket.lastRefillAt;
if (elapsedMs > 0) {
  const refilled = Math.floor((elapsedMs * this.config.tokensPerSecond) / 1000);
  bucket.tokens = Math.min(this.config.capacity, bucket.tokens + refilled);
  bucket.lastRefillAt = now; // <--- RESET TO 'now' REGARDLESS OF ACCUMULATED REMAINDER
}
```
Every time a client makes a request, the `elapsedMs` from their last request is computed. If `elapsedMs` is less than the time required to earn a single whole token, `refilled` truncates to `0` due to `Math.floor`.
Crucially, **`bucket.lastRefillAt` is still reset to `now`**, effectively discarding the fractional time the client had accumulated toward their next token!
For example, if `tokensPerSecond = 10` (1 token every 100ms):
- A client requests, depleting their bucket.
- 99ms later, the client requests again.
- `elapsedMs = 99`. `refilled = Math.floor(99 * 10 / 1000) = 0`.
- `bucket.lastRefillAt` is set to `now`, and the 99ms of progress is erased.
- If the client requests repeatedly every 99ms, they will **never** refill a single token, leading to permanent starvation and total service blockage.

### Code Location
- `packages/gateway-core/src/rate-limit.ts:38-51`

### Actionable Recommendation
Store and accumulate fractional/float tokens rather than truncating immediately on refill, or only advance `lastRefillAt` by the exact millisecond block corresponding to the integer tokens actually refilled:
```typescript
// Store tokens as fractional floats
getBucket(key): Bucket {
  const now = this.clock.now();
  let bucket = this.buckets.get(key);
  if (!bucket) {
    bucket = { tokens: this.config.capacity, lastRefillAt: now };
    this.buckets.set(key, bucket);
  } else {
    const elapsedMs = now - bucket.lastRefillAt;
    if (elapsedMs > 0) {
      const refilled = (elapsedMs * this.config.tokensPerSecond) / 1000;
      bucket.tokens = Math.min(this.config.capacity, bucket.tokens + refilled);
      bucket.lastRefillAt = now;
    }
  }
  return bucket;
}

// And check when consuming
tryConsume(key: string): boolean {
  const bucket = this.getBucket(key);
  if (bucket.tokens < 1) return false;
  bucket.tokens -= 1;
  return true;
}
```

---

## 4. Node.js ESM Import Cache Memory Leak on Plugin Reloads

### Impact: **Medium / Long-Term Stability Risk**
Each call to `plugin.reload` or `plugin.update` leaks memory and eventually loads stale code in Node.js, leading to unexpected behaviors or server crashes under continuous deployment or dynamic update environments.

### Root Cause
In `packages/plugin-manager/src/handler-loader.ts`, the Dynamic Import of plugin ESM modules occurs via:
```typescript
const raw = (await import(resolved)) as { default?: PluginHandlersExport };
```
Node's native ESM implementation caches dynamically imported files in perpetuity. The module cannot be garbage collected, and subsequential calls to `import` with the same path will fetch the cached export rather than loading changed files from disk.
If dynamic query parameters are appended to bypass the cache (e.g., `import(resolved + "?v=" + Date.now())`), the cache is indeed bypassed, but **the old module instances remain indefinitely pinned in V8 memory**, creating an irreversible memory leak.

### Code Location
- `packages/plugin-manager/src/handler-loader.ts:91-105`

### Actionable Recommendation
For enterprise production environments where pluggability must be robust:
1. Run untrusted or dynamic plugin execution in **isolated worker threads** (using Node `worker_threads`) or **separate subprocesses** (using `child_process`).
2. When a plugin is updated, disabled, or reloaded, terminate and recreate the worker or process. This is the only bulletproof way in Node.js to completely reclaim memory and discard native module caches.

---

## 5. Concurrent File Writing Race Conditions (Data Corruption / Loss)

### Impact: **High / Data Integrity Risk**
Under high concurrent API usage (e.g. concurrent `tenant.create` or multiple simultaneous plugin state modifications), the JSON metadata files (`tenants.json`, `installed-plugins.json`) can be corrupted, truncated, or overwritten with stale data (lost update anomaly).

### Root Cause
In `TenantStore` and `InstallStore` (`packages/plugin-manager/src/store.ts`), changes are persisted back to the filesystem asynchronously using `writeFile`:
```typescript
async save(): Promise<void> {
  const payload = JSON.stringify([...this.records.values()], null, 2);
  await this.fs.writeFile(this.tenantsPath, payload);
}
```
There is no filesystem-level file locking or internal mutex serialization. If two threads of execution write to the same file concurrently, their operations will interleave, which can lead to incomplete files or overwriting of recent records.

### Code Location
- `packages/gateway-core/src/tenant-store.ts:60-63`
- `packages/plugin-manager/src/store.ts:60-65`

### Actionable Recommendation
Use an atomic write-and-rename pattern combined with serial execution locks:
1. Write JSON data to a temporary file in the same directory (e.g. `tenants.json.tmp`).
2. Use an atomic fs operation like `fs.rename` (which is atomic on POSIX systems) to overwrite the target file.
3. Serialize calls to `save` using a simple Promise queue (mutex) or a robust library like `write-file-atomic`.

---

## 6. Multi-Replica Rate Limiting Bypass (In-Memory Isolation)

### Impact: **Medium / Scalability Risk**
If the Gateway is scaled out horizontally behind a load balancer to handle production traffic, rate limiting becomes completely inconsistent.

### Root Cause
The `RateLimiter` class maintains caller buckets exclusively in-memory. If there are 5 replicas of the Gateway, a malicious user can rotate their requests across the replicas, effectively enjoying 5 times the configured rate-limit threshold.

### Code Location
- `packages/gateway-core/src/rate-limit.ts:16-52`

### Actionable Recommendation
Provide an option to plug in a distributed back-end (such as Redis) for the token-bucket rate limiter, while keeping the in-memory implementation as a lightweight fallback for single-instance or local developments.

---

## 7. Lack of Input/Output Payload Validation on Invocation Dispatch

### Impact: **Medium / Reliability & Security Risk**
Handlers can receive malformed parameters from callers, triggering unhandled rejections, internal server errors, or crashes.

### Root Cause
`CapabilityRecord` exposes `inputSchema` and `outputSchema` of type `Readonly<object>`. However, inside `handleInvocation` or `dispatchCapability`, the inputs are passed directly to the handler with absolutely no automated schema verification.

### Code Location
- `packages/gateway-core/src/handle-invocation.ts:192-230`

### Actionable Recommendation
Integrate a highly efficient JSON schema validator (like `Ajv`) directly into the Gateway's `handleInvocation` pipeline. If a capability specifies an `inputSchema`, validate `req.input` against it prior to dispatching, and return a clean, descriptive `GATEWAY_INVALID_REQUEST` response upon validation failure.

---

## 8. Absence of Global Unhandled Exception/Rejection Handlers

### Impact: **Medium / Availability Risk**
An unhandled asynchronous exception inside a background worker or an SDK adapter can cause the entire Gateway process to crash and restart, interrupting service for all other connected sessions and tenants.

### Root Cause
Node.js default behavior on unhandled promise rejections (`--unhandled-rejections=strict`) is to terminate the process. In a platform executing arbitrary custom plugins and holding WebSockets from external apps, there is no top-level process safety net.

### Code Location
- `packages/agentide/src/cli.ts` (Entrypoint)

### Actionable Recommendation
Register global event handlers at the application entrypoint to log unexpected errors and prevent process termination wherever safe:
```typescript
process.on("uncaughtException", (error) => {
  console.error("CRITICAL UNCAUGHT EXCEPTION:", error);
  // Perform graceful shutdown if necessary
});

process.on("unhandledRejection", (reason, promise) => {
  console.error("UNHANDLED PROMISE REJECTION at:", promise, "reason:", reason);
});
```

---

## 9. Token Expiry Vulnerability to Server Clock Drift

### Impact: **Low / Operational Risk**
Clients are unexpectedly disconnected or rejected with `GATEWAY_TOKEN_EXPIRED` if the client's clock and the server's clock drift by even a few milliseconds, or expired tokens are accepted.

### Root Cause
In `verifyToken` inside `packages/gateway-core/src/auth.ts`:
```typescript
if (typeof claims.exp !== "number" || claims.exp <= clock.now()) {
  return { ok: false, code: ERROR_CODES.TOKEN_EXPIRED };
}
```
The comparison is strict and does not provide any "leeway" or tolerance window to accommodate normal operational clock skew between distributed systems.

### Code Location
- `packages/gateway-core/src/auth.ts:80-82`

### Actionable Recommendation
Allow a standard leeway window (e.g. 60 seconds) when validating temporal token claims (`exp`, `iat`, `nbf`):
```typescript
const LEEWAY_MS = 60000;
if (typeof claims.exp !== "number" || claims.exp <= (clock.now() - LEEWAY_MS)) {
  return { ok: false, code: ERROR_CODES.TOKEN_EXPIRED };
}
```
