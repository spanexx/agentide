# Agentide Production Risks & Architectural Gaps Analysis

This document identifies, analyzes, and classifies potential production issues, security vulnerabilities, reliability concerns, and scalability limits within the current Agentide architecture. Each risk is grounded in direct codebase file/line references, with concrete business/operational impacts and actionable mitigation strategies.

---

## Pillar 1: Authentication, Authorization & Security

### 1. Token Expiry Handshake & Connection Drops (Critical)
*   **Codebase References:**
    *   `packages/gateway-core/src/auth.ts:107-109` (checks token `exp` claim against current time)
    *   `packages/backend-runtime/src/server.ts:98` (verifies token only on initial `sdk.auth` message)
    *   `packages/sdk-node/src/client.ts:77` (handshakes once during connection initiation)
*   **Operational Mechanism:**
    The Gateway mints HS256 JWTs with an expiration claim (`exp`, typically 1 hour). When `@platform/sdk-node` opens a WebSocket connection to the Backend Runtime, it passes the bearer token to perform the initial auth handshake. Once accepted, the TCP socket remains open.
    However, if an SDK connection remains open longer than the token's lifetime, there is **no inline token refresh handshake** or keep-alive re-authentication mechanism. Under v1, any subsequent invocation routed through a connection with an expired token will be rejected by the handle-invocation pipeline with `GATEWAY_TOKEN_EXPIRED`, or if the connection closes and attempts to reconnect, it will fail to re-auth, dropping the application completely from the platform catalog.
*   **Business Impact:** High availability AI applications will silently go offline after 1 hour of continuous operation, failing to receive further capability dispatches or handle tasks.
*   **Mitigation:**
    1. Implement a proactive refresh-token rotation endpoint on the Gateway.
    2. Add an inline WS control frame (e.g., `sdk.auth.refresh`) that allows the SDK to push a freshly minted JWT before the old one expires without severing the TCP/WS connection.
    3. For on-premise/co-located deployments, support long-lived credentials with cryptographically secure revocation lists.

---

### 2. Lack of Server-Side Token Revocation / Blacklisting (Medium)
*   **Codebase References:**
    *   `packages/gateway-core/src/auth.ts:18` (`auth.token.revoke` is documented as a `no-op` in v1)
*   **Operational Mechanism:**
    Because token verification (`verifyToken`) is entirely stateless (checking signature validity and expiry), once a JWT is issued, it is legally valid for its entire lifetime. If a developer's token is compromised, leaked in client-side code, or if a user’s access is suspended, there is no way for the Gateway to immediately invalidate the token.
*   **Business Impact:** In a security breach scenario, compromised credentials cannot be invalidated immediately by operators, exposing platform capabilities, tenant data, and execution runtimes to unauthorized access for up to the token’s remaining TTL.
*   **Mitigation:**
    1. Implement a redis-backed or in-memory bloom filter / revocation blacklist for revoked token identifiers (`jti` claim).
    2. Ensure `auth.token.revoke` inserts the revoked token metadata into this blacklist, which is checked on every `verifyToken` execution.

---

### 3. Secure Secret Sharing & Management (Medium)
*   **Codebase References:**
    *   `packages/backend-runtime/src/server.ts:51` (uses `config.tokenSecret`)
    *   `packages/gateway-core/src/auth.ts:28` (requires shared HS256 key for verifying and signing)
    *   `packages/agentide/src/factory.ts:80-90` (bootstraps or reads a gateway-secret file)
*   **Operational Mechanism:**
    Currently, the Gateway and the Backend Runtime must share the *exact same* HS256 symmetric secret bytes to successfully sign and verify tokens. In a distributed multi-node topology, this requires distributing a shared symmetric key to all nodes. If the key is leaked or stolen from any single node, the entire cluster is fully compromised.
*   **Business Impact:** Compromising the symmetric secret on a single backend runtime node allows an attacker to sign arbitrary administrative JWTs and gain full control over all tenants and runtimes.
*   **Mitigation:**
    1. Migrate from symmetric HS256 to asymmetric RS256 or ES256 signing.
    2. The Gateway (Control Plane) signs tokens using a private key, and all other components (like Backend Runtimes, adapters) verify tokens using a distributed, read-only public key or JSON Web Key Sets (JWKS).

---

## Pillar 2: Resource Leaks, Network Failures & Reliability

### 4. In-Memory State Loss and Gateway Restart Outages (High)
*   **Codebase References:**
    *   `packages/gateway-core/src/rate-limit.ts` (in-memory bucket store)
    *   `packages/session-manager/src/index.ts` (in-memory session map)
    *   `packages/backend-runtime/src/registry.ts` (in-memory WebSocket connection mapping)
*   **Operational Mechanism:**
    All core Control Plane states—active sessions, rate-limiting tokens, active tenant configuration, and SDK WebSockets—live entirely in Node.js heap memory. If the `agentide` process restarts (due to an OS crash, rolling deployment, node rescheduling, or manual operator upgrade), **all active sessions are immediately lost**. Runtimes will have their handles severed, and connected SDKs will be disconnected and forced to perform complete reconnect backoffs and handshakes.
*   **Business Impact:** Operators cannot perform seamless zero-downtime rolling upgrades. Active long-running AI operations (such as multi-step browser automations or large file transformations) will be abruptly severed and failed with non-retryable errors.
*   **Mitigation:**
    1. Introduce a storage abstraction layer for session state and rate-limiting buckets (e.g., Redis or a durable SQLite store).
    2. Allow the Gateway to resume existing sessions and maintain capability state across process restarts.

---

### 5. Plugin Cleanup Hangs & Resource Leaking (High)
*   **Codebase References:**
    *   `packages/plugin-manager/src/uninstall.ts` (uninstalls plugins and handles cleanup)
    *   `packages/agentide/src/__tests__/gateway-plugin-dispatch.test.ts:stderr` (displays `[plugin-manager] cleanup confirmation timed out for plugin "browser" — uninstall proceeds anyway`)
*   **Operational Mechanism:**
    When uninstalling a runtime plugin (such as the browser or docker runtimes), the Plugin Manager sends a `plugin.cleanup` event and waits up to `cleanupTimeoutMs` (default 5000ms) for the plugin to confirm it has released its resources. If the plugin hangs, is stuck, or fails to confirm, **the Plugin Manager forcibly proceeds with uninstall anyway**, unregistering its capabilities and removing the record from disk.
*   **Business Impact:** Stuck runtime plugins (e.g., zombie puppeteer browser processes, dangling docker containers, temporary filesystem mounts) will be orphaned in the host OS. Over time, repeated plugin reinstall/uninstall cycles will leak memory, file handles, and processes, eventually exhausting OS resources and crashing the host machine.
*   **Mitigation:**
    1. Ensure the Plugin Manager executes a forced process termination or aggressive operating-system-level cleanup for any non-cooperative plugin that times out.
    2. Track host process IDs (PIDs) and container IDs spawned by plugins, so they can be forcibly reaped during uninstallation.

---

### 6. WebSocket Reconnect Storms (Medium)
*   **Codebase References:**
    *   `packages/sdk-node/src/client.ts:168-181` (implements exponential backoff with jitter)
*   **Operational Mechanism:**
    When the Control Plane goes down or restarts, thousands of active SDK instances will lose their sockets. While the SDK client implements exponential backoff with a default 20% jitter (`jitterRatio: 0.2`), the sudden surge of thousands of simultaneous clients trying to reconnect as soon as the listener port reopens can still cause a massive CPU and network spike on the Gateway.
*   **Business Impact:** "Thundering Herd" reconnect storms can overwhelm the Gateway's listener, causing connection drops, memory exhaustion, and extended service denial for incoming API calls.
*   **Mitigation:**
    1. Increase the default jitter range or introduce full random jitter (decorrelated jitter) on the client side.
    2. Place the Gateway/Backend Runtime behind a reverse proxy (e.g., Nginx, HAProxy, or Envoy) configured with strict TCP rate-limiting and connection-grouting rules.

---

## Pillar 3: Performance, Bottlenecks & Scalability

### 7. Process-Level Co-location of Runtime Plugins (Critical)
*   **Codebase References:**
    *   `packages/plugin-manager/src/handler-loader.ts` (uses Node's ESM `import()` to load plugins dynamically)
*   **Operational Mechanism:**
    Runtime plugins (such as `browser-runtime` or `docker-runtime`) are dynamically loaded via JavaScript `import()` directly into the **same Node.js process** as the Control Plane and Gateway. Because Node.js is single-threaded, any blocking synchronous execution or unhandled exception inside a plugin can compromise the entire Gateway.
*   **Business Impact:**
    A single CPU-heavy operation, an infinite loop, a memory leak, or an unhandled crash in a single runtime plugin will instantly block or crash the entire Control Plane. This violates tenant isolation and robust security boundaries—one tenant running a malicious plugin can take down the platform for all other tenants.
*   **Mitigation:**
    1. Run runtime plugins in separate, isolated OS processes or lightweight sandbox environments (e.g., Docker containers, WebAssembly sandboxes, or worker threads).
    2. Communicate between the Control Plane and Runtimes via local IPC (gRPC, Unix sockets, or lightweight WebSockets), rather than direct dynamic ESM imports.

---

### 8. Synchronous Event Bus Bottlenecks (Medium)
*   **Codebase References:**
    *   `packages/event-bus/src/index.ts` (processes subscribers sequentially in subscription order)
*   **Operational Mechanism:**
    The core Event Bus executes all synchronous handlers in sequential order before executing asynchronous handlers via `Promise.allSettled`. If a synchronous subscriber performs a blocking task or slow computation, it directly delays the delivery of the event to all subsequent subscribers on that event bus.
*   **Business Impact:** In a highly concurrent environment, a single slow event subscriber will severely bottleneck event propagation, leading to high latency in session management, logging, and dispatch systems.
*   **Mitigation:**
    1. Strictly enforce that event handlers are non-blocking.
    2. Run heavy computations asynchronously or delegate them to a background worker pool.

---

## Pillar 4: Operations & Maintainability

### 9. Indefinite Audit Log File Growth (High)
*   **Codebase References:**
    *   `packages/gateway-core/src/audit.ts` (appends JSON lines to `audit.log` indefinitely)
*   **Operational Mechanism:**
    Every single capability invocation—whether successful, denied, or errored—appends a structured JSON record on a new line to `audit.log`. There is no built-in log rotation, truncation, or maximum file size restriction inside the platform.
*   **Business Impact:** In highly active production environments handling millions of invocations per day, the host file system will eventually run out of disk space. This results in disk exhaustion, causing database crashes, write failures, and complete system-wide outages.
*   **Mitigation:**
    1. Integrate and document standard log-rotation utilities (like `logrotate`) in the production deployment guides.
    2. Add native, size-based or time-based rolling log-writers to the Gateway's audit writer.

### 10. Hardcoded Health Check Capabilities (Low)
*   **Codebase References:**
    *   `packages/platform-capabilities/src/caps.ts` (`system.health` registration)
    *   `packages/agentide/src/factory.ts` (returns `{ status: "ok" }` statically)
*   **Operational Mechanism:**
    The default `system.health` implementation simply returns a hardcoded `{ status: "ok" }` response. It does not inspect whether the Event Bus is alive, whether the Backend Runtime is accepting sockets, whether connected runtimes are healthy, or if local disk spaces are exhausted.
*   **Business Impact:** Automated orchestration systems (like Kubernetes liveness/readiness probes or AWS target group health monitors) will continue to route traffic to an Agentide node even if its internal components are fully degraded or unresponsive.
*   **Mitigation:**
    1. Replace the hardcoded response with an active probe cycle that queries critical platform components (Session Manager, Plugin Manager, event-bus heartbeat).
    2. Expose structured metrics (such as active websocket count, rate-limit rejection rate) through a `/metrics` or Prometheus-compatible endpoint.
