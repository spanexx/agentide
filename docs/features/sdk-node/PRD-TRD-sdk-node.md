# PRD-TRD: sdk-node (Backend SDK)

**Slug:** sdk-node
**Status:** Draft
**Date:** 2026-07-29

## Why This Exists

Application developers need a way to expose their business capabilities to the Agentide platform. Today, the Gateway (`@platform/gateway-core`) is fully shipped — it can route capability invocations to handlers, enforce authz, manage sessions, audit calls. The plugin manager registers runtime plugins the same way. But there's no path for a **customer's own application** to register its own capabilities and have the platform discover + invoke them.

The architecture (`docs/architecture/Agentide.md` §6) explicitly defines the Backend SDK role for this: "Register capabilities, Authenticate with Gateway, Execute capability handlers, Emit events." Without it, the Gateway is a closed system — only the platform's own packages can serve capabilities. The MCP adapter (next pack, #9) and the dashboard both need apps to *exist* before they have something to connect to.

The cost of leaving this unsolved: every developer who wants their app on Agentide has to hand-roll a WebSocket client, a token issuer, a registration protocol, an event emitter, a reconnect strategy. None of that is the developer's actual problem. Their problem is "I have a `customer.read` function — make it invocable."

## Behavioral Spec

### Scenario 1: developer calls `connect()` and SDK connects to the Gateway

**Given** an app with `@platform/sdk-node` installed, a manifest file at `./manifest.yaml`, a handlers module at `./dist/handlers`, and a Gateway URL set in `GATEWAY_URL` env var
**When** the developer runs `await sdk.connect()`
**Then** the SDK opens a WebSocket to the Gateway, exchanges a JWT for an SDK token, and emits `sdk.connected` on the bus. The terminal pane shows "✓ connected (1.2s)" and the lifecycle dot advances to "connect".

### Scenario 2: developer calls `register()` and capabilities are advertised

**Given** the SDK is connected
**When** the developer runs `await sdk.register()`
**Then** the SDK reads the manifest, imports the handlers module, matches handler names to capability names, calls `capability.register` for each, and emits `sdk.capability.registered` per capability. Two cards (for our 2-cap sample manifest) fade in on the left panel; the event log shows two `sdk.capability.registered` entries.

### Scenario 3: a capability is invoked and the result returns

**Given** a capability `customer.read` is registered, an invocation request comes from the Gateway
**When** the Gateway dispatches `customer.read` with input `{customerId: "c-042"}`
**Then** the SDK looks up the handler, calls it, returns the result `{id: "c-042", name: "Customer 042", email: "..."}` to the Gateway. The capability card flashes blue, an `sdk.invoke.completed` event is emitted, and the terminal pane shows "← result: {…}".

### Scenario 4: handler throws an error

**Given** `customer.read` is registered, an invocation comes with input `{customerId: "unknown"}` (handler throws `not found: unknown`)
**When** the Gateway dispatches the call
**Then** the SDK returns the error to the Gateway, which converts it to `GATEWAY_CAPABILITY_ERROR`. The capability card flashes red, an `sdk.invoke.failed` event is emitted, and the terminal shows "✗ error: not found: unknown".

### Scenario 5: Gateway connection drops, SDK auto-reconnects

**Given** capabilities are registered and the SDK is in steady state
**When** the Gateway connection drops unexpectedly (e.g. Gateway process dies, network blip — *not* a developer-initiated `sdk.disconnect()`)
**Then** the SDK emits `sdk.disconnected` (with `reason="simulated-drop"` for the test harness, or `reason="error"` for a real network close), schedules reconnect with exponential backoff (1s, 2s, 4s, ... capped at 30s with ±20% jitter), reconnects, re-registers all capabilities automatically, emits `sdk.capability.registered` per capability (with `reconnected: true` in the payload), and returns to steady state. No operator intervention required.

> **Note on the sim's `disconnect` command:** The simulation's `disconnect` command does **not** call `sdk.disconnect()` directly — that would suppress auto-reconnect (per `disconnect()` contract above). Instead it triggers a mock close event via a dropper, simulating a Gateway crash so the reconnect path is observable. Use `reset` to actually tear down the SDK instance without reconnect.

### Scenario 6: developer resets the SDK

**Given** any state
**When** the developer runs `sdk.reset()` (or `reset` in the terminal)
**Then** the SDK clears local capability registrations, resets the lifecycle to `init`, and clears the event log. The next `connect()` starts fresh.

### Scenario 7: invalid command

**Given** any state
**When** the developer types an unknown command (`disconnec` typo)
**Then** the terminal prints `unknown command: disconnec. type "help".` in red. The lifecycle and event log are unchanged.

## Simulation Contract

The pre-impl sim (`docs/features/sdk-node/simulate-pre.html`) demonstrates all 7 scenarios through a unified HTML page with two panels:

- **Left panel (visual state):** lifecycle timeline (5 dots: init, connect, register, invoke, disconnect), capability cards (fade in on register, flash blue on invoke, flash red on error), event log (events slide in from the right with timestamps)
- **Right panel (xterm.js terminal):** accepts commands `connect`, `register`, `invoke <name> [json]`, `disconnect`, `state`, `reset`, `help`

The post-impl sim (Phase 4) will replace the hardcoded sample manifest + handlers with the **real** `@platform/sdk-node` package. The terminal pane, lifecycle, cards, and event log stay; the engine underneath changes from inline stubs to actual SDK calls.

| Scenario | Pre-impl sim demo | Post-impl sim must demonstrate |
|---|---|---|
| 1 | `connect` → "✓ connected (1.2s)" + `sdk.connected` event | Same output via real SDK |
| 2 | `register` → 2 cards fade in + 2 events | Same output via real SDK |
| 3 | `invoke customer.read {"customerId":"c-042"}` → result + blue flash | Same output, real `handleInvocation` |
| 4 | `invoke customer.read {"customerId":"unknown"}` → red flash + error event | Same, real error path |
| 5 | `disconnect` → reconnect dots + re-registration | Same, real WebSocket reconnect |
| 6 | `reset` → clean state | Same, real `sdk.reset()` |
| 7 | `disconnec` → "unknown command" | Same parser behavior |

## Technical Design

### Data Models

**Manifest shape** (YAML or JSON, loaded by the SDK):

```yaml
app: customer-app               # app identifier; required
name: Acme Customer Service     # human-readable; optional
capabilities:                   # required, list
  - name: customer.read         # required, format: <domain>.<action>
    description: Fetch ...      # required
    version: 1.0.0              # required, semver
    permissions:                # required, list of strings
      - customer.read
    inputSchema: {...}          # optional, JSON Schema
    outputSchema: {...}         # optional, JSON Schema
    tier: read                  # optional, default derived from permissions
```

Per GRILL Q3: permissions live **per capability** (security boundary visible per cap). Per GRILL Q8: manifest and handlers are separate files.

**Handler module shape** (TypeScript, ESM):

```typescript
// src/handlers/customer.ts
import type { HandlerContext } from "@platform/sdk-node";

export async function customerRead(
  input: { customerId: string },
  ctx: HandlerContext,
): Promise<{ id: string; name: string; email: string }> {
  const customer = await db.customers.findOne({ id: input.customerId });
  if (!customer) throw new Error(`not found: ${input.customerId}`);
  return { id: customer.id, name: customer.name, email: customer.email };
}
```

**HandlerContext** (passed to every handler):

```typescript
interface HandlerContext {
  readonly app: { id: string; name: string };
  readonly call: {
    readonly id: string;            // unique per invocation
    readonly capability: string;    // e.g. "customer.read"
    readonly token: string;         // caller's JWT
    readonly sessionId?: string;     // if the caller has a session
  };
  readonly log: { info, warn, error };  // SDK logger
}
```

**Public API surface** (the SDK factory):

```typescript
// src/index.ts
export function createSdk(config: SdkConfig): SdkInstance;
export type SdkConfig = {
  gateway: { url: string; token: string };
  app: { id: string; name: string };
  manifest: string | ManifestObject;  // path to manifest.yaml/.json OR inline object (Phase 7)
  handlers: string | Record<string, Function>;  // path to module OR direct map
  observability?: { logger?: Logger };  // optional plug-in
};
export type SdkInstance = {
  connect(): Promise<void>;
  register(): Promise<void>;
  invoke(name: string, input: object): Promise<unknown>;
  disconnect(): Promise<void>;
  reset(): void;
  state(): { phase, capabilities };
};
```

### API Contracts

**`connect()`** — opens WebSocket, exchanges token, emits `sdk.connected`. Fails fast on unreachable Gateway (caller catches the error).

**`register()`** — reads manifest, imports handlers, sends one `sdk.capability.register` per capability to the Gateway. Throws on (synchronous, local validation only):
- Manifest not found
- Manifest invalid (schema mismatch)
- Handler not found for a manifest capability (mismatch)

Gateway-level rejections (e.g. capability collision, unauthorized) are **asynchronous** and surfaced via the `sdk.capability.rejected` event on the event bus — `register()` itself always resolves successfully. The operator subscribes to that event to learn about a refusal. See `events.ts:177-187` and the inbound dispatch path in `invoke.ts:106-117`.

**`invoke(name, input)`** — typically called by the SDK's WebSocket message handler, not by the developer. But exposed for testing and direct use.

**`disconnect()`** — closes WebSocket cleanly and emits `sdk.capability.unregistered` for every previously-registered capability, then `sdk.disconnected`. **No auto-reconnect** — explicit disconnect is a clean break. Auto-reconnect only fires on *unexpected* network close (e.g. Gateway process dies); see `client.ts:136-138, 177-178`.

**`reset()`** — clears local state, no network calls.

### Events emitted

All on the shared `@platform/event-bus`:

| Event | Payload | When |
|---|---|---|
| `sdk.connected` | `{ appId, gatewayUrl, latencyMs }` | After WebSocket opens + auth succeeds |
| `sdk.disconnected` | `{ appId, reason }` | When WebSocket closes (any reason) |
| `sdk.capability.registered` | `{ appId, capability, reconnected: boolean }` | After each capability registered (initial or post-reconnect) |
| `sdk.capability.unregistered` | `{ appId, capability }` | On `disconnect()` or `reset()` |
| `sdk.invoke.started` | `{ appId, callId, capability, input }` | Before dispatching to handler |
| `sdk.invoke.completed` | `{ appId, callId, capability, durationMs }` | After handler returns successfully |
| `sdk.invoke.failed` | `{ appId, callId, capability, error }` | When handler throws |
| `sdk.capability.rejected` | `{ appId, capability, reason }` | When Gateway refuses a `sdk.capability.register` (asynchronous — fired later via inbound dispatch) |

### Dependencies

**No new external dependencies** beyond what the repo already uses:

- `ws` (WebSocket client) — already in package.json (gateway-core uses it)
- `@platform/event-bus` — already a workspace package
- `yaml` (manifest parser) — already in package.json
- Standard `node:fs/promises`, `node:path` for file I/O

Run `opensrc` if a new dep is added. For v1, no new deps are introduced.

### Architecture Notes

**Module layout** (Phase 7 — actual):

```
packages/sdk-node/
├── src/
│   ├── index.ts              # public API: createSdk, SdkConfig, SdkInstance
│   ├── client.ts             # WebSocket client wrapper (reconnect, backoff + jitter)
│   ├── manifest.ts           # parser + validator for the manifest file/object
│   ├── register.ts           # manifest→handlers matching + send to Gateway
│   ├── invoke.ts             # handler dispatch (inbound from Gateway)
│   ├── lifecycle.ts          # WebSocket event wiring (open/close/message)
│   ├── events.ts             # SdkEventPublisher + 8 event payload types (Phase 7)
│   ├── types.ts              # SdkConfig, SdkInstance, HandlerContext
│   └── __tests__/
│       ├── client.test.ts
│       ├── manifest.test.ts
│       ├── register.test.ts
│       ├── invoke.test.ts
│       ├── lifecycle.test.ts
│       ├── events.test.ts    # Phase 7: all 7 events
│       └── skeleton.test.ts
├── package.json
└── README.md
```

**Note on the original layout** (PRD-TRD v1): the spec listed `handler-loader.ts`
and `events.ts` as separate files. The handler-loader was merged into
`register.ts` (`resolveHandlers()`) — a refactor with no behavior change.
`events.ts` was added back in Phase 7 to hold the 8 event payload types and
the `SdkEventPublisher` wrapper.

**Connection lifecycle:**

```
connect() opens WebSocket
  └─ onopen: auth handshake (token)
      └─ on success: emit sdk.connected, set phase='connected'
  └─ onerror: throw (caller decides what to do; default = exit)

(developer calls) register()
  └─ for each capability: send register message to Gateway
      └─ on ack: emit sdk.capability.registered, set phase='registered'

(Gateway dispatches) invoke
  └─ WebSocket message arrives
      └─ lookup handler by name
          └─ call handler(input, ctx)
              └─ return result OR catch error
                  └─ send response back to Gateway
                      └─ emit sdk.invoke.completed / failed

(Gateway dies) WebSocket closes
  └─ emit sdk.disconnected
  └─ schedule reconnect with backoff (1s, 2s, 4s, capped at 30s)
      └─ reconnect succeeds
          └─ re-emit sdk.connected
          └─ re-register every capability
              └─ emit sdk.capability.registered (with reconnected=true)
              └─ set phase='registered'
```

**Pluggable runtime (Q7 lock):** v1 ships in-process only. Future versions (v3 in `future.md`) ship Lambda / edge / worker pool adapters. The interface boundary is `HandlerContext` + the handler signature; alternate runtimes just import handlers differently.

## Non-Goals

- **Token refresh flow.** Deferred to v2.1 (drift #14). SDK connections die silently after `expiresInMs`.
- **App-side event subscription.** Apps register capabilities; they don't observe platform events. (GRILL Q6-A.)
- **Out-of-process / edge runtimes.** v1 is in-process only. (Q7-C: design allows it; v3 implements it.)
- **Multi-app per process.** One app per SDK instance. (v2.4.)
- **Schema validation beyond basic JSON shape.** `inputSchema` / `outputSchema` are declared but not enforced by v1. (v2.2.)
- **Metrics / tracing SDK-side.** No OTel, no Prometheus exporter. (v2.3.)
- **CLI debug tools** for the SDK. The terminal pane in the sim is illustrative only.
- **Frontend SDK** (`@platform/sdk-browser`). Separate pack (#11).
- **Capability invocation semantics.** That's the gateway-core contract; the SDK just consumes it.

## Out of Scope (Future)

- v2.1 — Token refresh flow (drift #14)
- v2.2 — Schema validation
- v2.3 — Observability hooks (OTel, metrics)
- v2.4 — Multi-app per process
- v3.1 — Lambda runtime
- v3.2 — Edge runtime (Cloudflare Workers / Deno Deploy)
- v3.3 — Worker pool
- v4.1 — App-side subscriptions (Q6 flipped)
- v4.2 — Capability deprecation flow
- v4.3 — Marketplace integration

See `future.md` for the full v2/v3/v4/v5 plan.

## References

- GRILL-sdk-node.txt — 9 questions locked
- future.md — deferred work for v2/v3/v4/v5
- simulate-pre.html — design rehearsal (HTML with xterm.js terminal)
- docs/architecture/Agentide.md §6 (SDKs role) and §9 (Gateway auth)
- docs/CONTEXT.md (SDK section, naming convention)
- docs/architecture/Terminology.md (Backend SDK / Frontend SDK roles)
- docs/Feature_Backlog.md #8 (sdk-node row)
- packages/gateway-core/src/{auth,factory}.ts (current gateway surface)
- packages/event-bus/src/* (event model)
- packages/capability-registry/src/* (manifest validation patterns)
- docs/drift-issue-log.md #14 (token refresh flow)