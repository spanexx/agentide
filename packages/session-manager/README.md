# @platform/session-manager

Owns the lifecycle of every session — the unit that holds runtime resources (browser tabs, temp files, DB transactions) and is the natural scope for capability calls that need state.

Sessions move through three states: **Active** (running, holding resources), **Suspended** (paused, resources retained), **Archived** (soft-deleted after destroy, metadata kept for a configurable TTL, resources already cleaned up). The Session Manager owns the transition rules, the resource accounting, and the cleanup ordering; the Gateway and adapters interact with sessions by id.

## Install

Workspace dependency on `@platform/event-bus`. No external runtime dependencies.

## Usage

```ts
import { createEventBus } from "@platform/event-bus";
import { createSessionManager } from "@platform/session-manager";

const bus = createEventBus();
const sm = createSessionManager(bus, {
  defaultIdleTimeoutMs: 300_000,   // 5 min → Suspended
  defaultArchiveTtlMs: 1_800_000,  // 30 min → Archived
});

// Lifecycle
const session = sm.create({ ownerId: "agent-1", adapterType: "mcp" });
// session.id is a UUID; session.status is "active".

const active = sm.resume(session.id);             // throws if not suspended
const touched = sm.touch(session.id);             // resets idle timer (no-op if not active)
sm.destroy(session.id);                            // suspends if active, fires cleanup

// Resource tracking
sm.attachResource(session.id, { kind: "browser-tab", ref: "tab-7" });
const resources = sm.listResources(session.id);
sm.detachResource(session.id, { kind: "browser-tab", ref: "tab-7" });
```

## Contract

- A session starts **Active** when created. `idleTimeoutMs` (per session, falls back to `defaultIdleTimeoutMs`) moves it to **Suspended**. `archiveTtlMs` from suspension moves it to **Archived**.
- `resume(id)` requires the session to be **Suspended** — throws `SessionAlreadyActiveError` if active, `SessionNotFoundError` if missing, `SessionArchivedError` if archived.
- `touch(id)` is a no-op on missing/archived sessions and resets the idle timer on active/suspended sessions.
- `destroy(id)` is the cleanup path: if active, fires `session.cleanup_resources` first (waits for plugins to release resources), then transitions to **Archived** and fires `session.destroyed`.
- `attachResource` permits suspended sessions (operator may legitimately reattach before resume). Resources are referenced objects (`{kind, ref}`) — the Session Manager does not own their content, just the bookkeeping.
- Lifecycle events fire on the Event Bus: `session.created`, `session.suspended`, `session.resumed`, `session.destroyed`, `session.cleanup_resources`. `session.cleanup_resources` fires BEFORE `session.destroyed`.
- `getStatus(id)` returns the current state + last-transition timestamp.

## Public surface

| Export | Kind |
|---|---|
| `createSessionManager` | factory |
| `SessionManager` | interface (`create`, `resume`, `touch`, `destroy`, `getStatus`, `attachResource`, `detachResource`, `listResources`) |
| `SessionRecord` | interface (session state: id, ownerId, adapterType, status, timestamps) |
| `Resource` | interface (`{kind, ref}` reference shape) |
| `SessionStatus` | type (`"active" \| "suspended" \| "archived"`) |
| `SessionNotFoundError` / `SessionArchivedError` / `SessionAlreadyActiveError` | typed errors |

## Design references

- PRD: [docs/features/session-manager/PRD-session-manager.md](../../docs/features/session-manager/PRD-session-manager.md)
- TRD: [docs/features/session-manager/TRD-session-manager.md](../../docs/features/session-manager/TRD-session-manager.md)
- FLOW: [docs/features/session-manager/FLOW-session-manager.md](../../docs/features/session-manager/FLOW-session-manager.md)
- IMPL: [docs/features/session-manager/IMPL-session-manager.md](../../docs/features/session-manager/IMPL-session-manager.md)
- GRILL: [docs/features/session-manager/GRILL-session-manager.txt](../../docs/features/session-manager/GRILL-session-manager.txt)
- EXPLAINED: [docs/features/session-manager/EXPLAINED-session-manager.txt](../../docs/features/session-manager/EXPLAINED-session-manager.txt)
- Glossary: [docs/CONTEXT.md](../../docs/CONTEXT.md) → *Session*, *Session Manager*, *Resource*